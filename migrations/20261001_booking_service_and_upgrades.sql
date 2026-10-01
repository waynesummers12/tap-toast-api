begin;
alter table public.events add column if not exists service_type text not null default 'bartending' check (service_type in ('bartending', 'soda'));
alter table public.quotes add column if not exists service_type text not null default 'bartending' check (service_type in ('bartending', 'soda'));
create table if not exists public.paid_upgrades (
 stripe_session_id text primary key,
 event_id uuid not null references public.events(id),
 upgrade_type text not null check (upgrade_type in ('extra_hour','premium_drinks','extra_bartender')),
 amount_cents integer not null check (amount_cents > 0),
 applied_at timestamptz not null default now(),
 customer_email_sent_at timestamptz
);
alter table public.paid_upgrades enable row level security;
revoke all on public.paid_upgrades from anon, authenticated;
grant all on public.paid_upgrades to service_role;
-- One transaction locks the event, applies the purchase, and records its session.
-- The ledger is also the record of premium-drink purchases for fulfillment.
create or replace function public.apply_paid_upgrade(p_session text, p_event uuid, p_upgrade text, p_amount integer)
returns void language plpgsql security invoker set search_path = public as $$
declare prior public.paid_upgrades%rowtype;
begin
 if p_session is null or p_session = '' or p_upgrade is null or p_amount is null or
    p_upgrade not in ('extra_hour','premium_drinks','extra_bartender') or
    p_amount <> (case p_upgrade when 'extra_hour' then 10000 when 'premium_drinks' then 15000 when 'extra_bartender' then 20000 end) then
   raise exception 'Invalid upgrade';
 end if;
 perform 1 from public.events where id = p_event for update;
 if not found then raise exception 'Event not found'; end if;
 select * into prior from public.paid_upgrades where stripe_session_id = p_session;
 if found then
   if prior.event_id <> p_event or prior.upgrade_type <> p_upgrade or prior.amount_cents <> p_amount then raise exception 'Session mismatch'; end if;
   return;
 end if;
 insert into public.paid_upgrades(stripe_session_id,event_id,upgrade_type,amount_cents) values(p_session,p_event,p_upgrade,p_amount);
 update public.events set
   hours = hours + case when p_upgrade = 'extra_hour' then 1 else 0 end,
   bartenders_needed = bartenders_needed + case when p_upgrade = 'extra_bartender' then 1 else 0 end,
   total_price = total_price + p_amount / 100.0,
   custom_total_price = case when custom_total_price is null then null else custom_total_price + p_amount / 100.0 end
 where id = p_event;
 -- Upgrade is paid in full; existing deposit and remaining balance stay unchanged.
end;
$$;
revoke all on function public.apply_paid_upgrade(text,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.apply_paid_upgrade(text,uuid,text,integer) to service_role;
commit;
