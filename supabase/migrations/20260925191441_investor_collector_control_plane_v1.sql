create schema if not exists collector_private authorization postgres;

revoke all on schema collector_private from public, anon, authenticated, service_role;

create table public.broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('MT4','MT5')),
  login text not null check (btrim(login) <> '' and length(login) <= 64),
  server text not null check (btrim(server) <> '' and length(server) <= 128),
  display_name text null check (display_name is null or length(display_name) <= 120),
  state text not null default 'PENDING_VALIDATION'
    check (state in ('PENDING_VALIDATION','VALIDATING','CONNECTED','DEGRADED','ERROR','DISCONNECTED')),
  collector_key_id text not null check (btrim(collector_key_id) <> '' and length(collector_key_id) <= 128),
  last_sync_at timestamptz null,
  last_error_code text null check (last_error_code is null or length(last_error_code) <= 128),
  last_error_at timestamptz null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, login, server)
);

comment on table public.broker_connections is
  'Direct MT4/MT5 investor-mode connection metadata only. Never stores broker password or ciphertext.';
comment on column public.broker_connections.collector_key_id is
  'Collector public-key identifier used to encrypt the Investor Password client-side.';

alter table public.broker_connections enable row level security;

revoke all on table public.broker_connections from public, anon, authenticated, service_role;
grant select on table public.broker_connections to authenticated;
grant select, insert, update, delete on table public.broker_connections to service_role;

create policy "broker connections read own"
on public.broker_connections
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.is_approved_member())
);

create index broker_connections_user_state_idx
on public.broker_connections(user_id, state);

create table collector_private.broker_credentials (
  connection_id uuid primary key
    references public.broker_connections(id) on delete cascade,
  key_id text not null check (btrim(key_id) <> '' and length(key_id) <= 128),
  algorithm text not null default 'RSA-OAEP-SHA256'
    check (algorithm = 'RSA-OAEP-SHA256'),
  ciphertext bytea not null check (octet_length(ciphertext) > 0),
  created_at timestamptz not null default now(),
  rotated_at timestamptz null
);

comment on table collector_private.broker_credentials is
  'Encrypted Investor Password ciphertext only. Private schema; never exposed to browser roles.';

create table collector_private.collector_nodes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and length(name) <= 120),
  key_id text not null unique check (btrim(key_id) <> '' and length(key_id) <= 128),
  public_key_pem text not null check (btrim(public_key_pem) <> ''),
  auth_token_hash text not null unique check (btrim(auth_token_hash) <> ''),
  enabled boolean not null default true,
  last_seen timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table collector_private.collector_nodes is
  'Owned Windows collector identities. Stores public key and hashed collector auth token, never token plaintext.';

create table collector_private.collector_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.broker_connections(id) on delete cascade,
  job_type text not null
    check (job_type in ('VALIDATE','SYNC')),
  status text not null default 'QUEUED'
    check (status in ('QUEUED','LEASED','SUCCEEDED','FAILED','CANCELLED')),
  attempt integer not null default 0 check (attempt >= 0 and attempt <= 20),
  scheduled_at timestamptz not null default now(),
  lease_until timestamptz null,
  leased_by uuid null
    references collector_private.collector_nodes(id) on delete set null,
  last_error_code text null check (last_error_code is null or length(last_error_code) <= 128),
  created_at timestamptz not null default now(),
  finished_at timestamptz null
);

comment on table collector_private.collector_jobs is
  'Internal validation/sync queue for the owned collector.';

create index collector_jobs_ready_idx
on collector_private.collector_jobs(status, scheduled_at, lease_until);

alter table collector_private.broker_credentials enable row level security;
alter table collector_private.collector_nodes enable row level security;
alter table collector_private.collector_jobs enable row level security;

revoke all on all tables in schema collector_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema collector_private from public, anon, authenticated, service_role;
revoke all on all functions in schema collector_private from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema collector_private
  revoke select, insert, update, delete, truncate, references, trigger on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema collector_private
  revoke usage, select, update on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema collector_private
  revoke execute on functions from public, anon, authenticated, service_role;
