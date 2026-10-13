begin;
-- App database operations run on the API using service_role. Browser keys are for Auth only.
alter table public.availability enable row level security;
alter table public.customers enable row level security;
alter table public.event_bartenders enable row level security;
alter table public.bartenders enable row level security;
alter table public.event_notes enable row level security;
alter table public.quotes enable row level security;
alter table public.events enable row level security;
alter table public.payments enable row level security;
commit;
