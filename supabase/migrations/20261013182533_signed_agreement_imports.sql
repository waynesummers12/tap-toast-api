-- Apply before publishing the agreement API. Additive; existing events are retained.
begin;
alter table public.events add column if not exists drinks_serving text;

create table if not exists public.event_agreements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid unique references public.events(id),
  file_hash text not null unique check(length(file_hash)=64),
  file_name text not null,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
alter table public.event_agreements enable row level security;
revoke all on public.event_agreements from public, anon, authenticated;
grant select,insert,update,delete on public.event_agreements to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('event-agreements','event-agreements',false,10485760,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Called only by the admin-checked API using its server-side service key.
-- One transaction prevents partial imports; the locked agreement prevents double clicks/retries.
create or replace function public.import_signed_agreement(p_agreement_id uuid,p_details jsonb,p_allow_duplicate boolean default false)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  agreement public.event_agreements%rowtype;
  customer_uuid uuid;
  event_uuid uuid;
  email_value text := nullif(lower(trim(p_details->>'email')),'');
  total numeric := (p_details->>'total_price')::numeric;
  deposit numeric := (p_details->>'deposit_amount')::numeric;
  paid boolean := (p_details->>'deposit_paid')::boolean;
  fully_paid boolean := (p_details->>'balance_paid')::boolean;
begin
  select * into agreement from public.event_agreements where id=p_agreement_id for update;
  if not found then raise exception 'AGREEMENT_NOT_FOUND'; end if;
  if agreement.event_id is not null then return agreement.event_id; end if;
  if total is null or deposit is null or total<0 or total>1000000 or deposit<0 or deposit>total
    or paid is null or fully_paid is null or (fully_paid and not paid)
    or nullif(trim(p_details->>'name'),'') is null
    or nullif(trim(p_details->>'location'),'') is null
    or (p_details->>'service_type') not in ('bartending','soda')
    or (p_details->>'hours')::int not between 1 and 168
    or (p_details->>'bartenders_needed')::int not between 0 and 100
  then raise exception 'INVALID_EVENT_DETAILS'; end if;

  -- Serializes imports for the same customer, including two different files.
  perform pg_advisory_xact_lock(hashtextextended(coalesce(email_value,lower(p_details->>'name')),0));
  if not p_allow_duplicate and exists (
    select 1 from public.events e join public.customers c on c.id=e.customer_id
    where e.event_date=(p_details->>'event_date')::date and e.event_status is distinct from 'cancelled'
      and ((email_value is not null and lower(c.email)=email_value)
        or (lower(c.name)=lower(p_details->>'name') and lower(e.location)=lower(p_details->>'location')))
  ) then raise exception 'POSSIBLE_DUPLICATE'; end if;

  if email_value is not null then
    select id into customer_uuid from public.customers where lower(email)=email_value limit 1;
  end if;
  if customer_uuid is null then
    insert into public.customers(name,email,phone)
    values (p_details->>'name',email_value,nullif(p_details->>'phone',''))
    on conflict(email) do nothing returning id into customer_uuid;
    if customer_uuid is null then select id into customer_uuid from public.customers where email=email_value; end if;
  end if;

  insert into public.events(customer_id,event_date,start_time,location,hours,bartenders_needed,bartenders,guest_count,
    total_price,custom_total_price,deposit_amount,deposit_paid,balance_paid,balance_due,
    event_status,status,service_type,drinks_serving)
  values(customer_uuid,(p_details->>'event_date')::date,nullif(p_details->>'start_time',''),p_details->>'location',
    (p_details->>'hours')::int,(p_details->>'bartenders_needed')::int,(p_details->>'bartenders_needed')::int,
    nullif(p_details->>'guest_count','')::int,total,total,deposit,paid,fully_paid,
    case when fully_paid then 0 else total-deposit end,
    'imported','imported',p_details->>'service_type',nullif(p_details->>'drinks_serving','')) returning id into event_uuid;
  update public.event_agreements set event_id=event_uuid where id=agreement.id;
  return event_uuid;
end;
$$;
revoke all on function public.import_signed_agreement(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.import_signed_agreement(uuid,jsonb,boolean) to service_role;
commit;
