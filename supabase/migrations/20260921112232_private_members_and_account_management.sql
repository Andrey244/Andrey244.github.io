create table if not exists public.app_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('owner','member')),
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create table if not exists public.account_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  account text not null,
  server text not null default '',
  label text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, source, account, server)
);

alter table public.app_members enable row level security;
alter table public.account_settings enable row level security;

create or replace function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_members
    where user_id = auth.uid() and approved = true
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_members
    where user_id = auth.uid() and approved = true and role = 'owner'
  );
$$;

revoke all on function public.is_approved_member() from public, anon;
grant execute on function public.is_approved_member() to authenticated;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_members(user_id,email,role,approved)
  values (new.id, coalesce(new.email,''), 'member', false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_journal_member on auth.users;
create trigger on_auth_user_created_journal_member
after insert on auth.users
for each row execute function public.handle_new_auth_user();

insert into public.app_members(user_id,email,role,approved,approved_at)
select
  u.id,
  coalesce(u.email,''),
  case when k.user_id is not null then 'owner' else 'member' end,
  case when k.user_id is not null then true else false end,
  case when k.user_id is not null then now() else null end
from auth.users u
left join public.ingest_keys k on k.user_id=u.id
on conflict (user_id) do update
set email=excluded.email,
    role=case when public.app_members.role='owner' then 'owner' else excluded.role end,
    approved=case when public.app_members.role='owner' then true else excluded.approved end,
    approved_at=case when public.app_members.role='owner' then coalesce(public.app_members.approved_at,now()) else excluded.approved_at end;

drop policy if exists "members read" on public.app_members;
create policy "members read" on public.app_members
for select to authenticated
using (user_id = auth.uid() or public.is_owner());

drop policy if exists "owner updates members" on public.app_members;
create policy "owner updates members" on public.app_members
for update to authenticated
using (public.is_owner())
with check (public.is_owner());

drop policy if exists "account settings read own" on public.account_settings;
create policy "account settings read own" on public.account_settings
for select to authenticated
using (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "account settings insert own" on public.account_settings;
create policy "account settings insert own" on public.account_settings
for insert to authenticated
with check (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "account settings update own" on public.account_settings;
create policy "account settings update own" on public.account_settings
for update to authenticated
using (user_id=auth.uid() and public.is_approved_member())
with check (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "account settings delete own" on public.account_settings;
create policy "account settings delete own" on public.account_settings
for delete to authenticated
using (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "manage own ingest key" on public.ingest_keys;
create policy "manage own ingest key" on public.ingest_keys
for all to authenticated
using (user_id=auth.uid() and public.is_approved_member())
with check (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "read own raw events" on public.raw_events;
create policy "read own raw events" on public.raw_events
for select to authenticated
using (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "read own notes" on public.trade_notes;
create policy "read own notes" on public.trade_notes
for select to authenticated
using (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "insert own notes" on public.trade_notes;
create policy "insert own notes" on public.trade_notes
for insert to authenticated
with check (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "update own notes" on public.trade_notes;
create policy "update own notes" on public.trade_notes
for update to authenticated
using (user_id=auth.uid() and public.is_approved_member())
with check (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "delete own notes" on public.trade_notes;
create policy "delete own notes" on public.trade_notes
for delete to authenticated
using (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "read own settings" on public.user_settings;
create policy "read own settings" on public.user_settings
for select to authenticated
using (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "insert own settings" on public.user_settings;
create policy "insert own settings" on public.user_settings
for insert to authenticated
with check (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "update own settings" on public.user_settings;
create policy "update own settings" on public.user_settings
for update to authenticated
using (user_id=auth.uid() and public.is_approved_member())
with check (user_id=auth.uid() and public.is_approved_member());

create or replace function public.create_or_rotate_ingest_token()
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid;
  plain_token text;
begin
  uid := auth.uid();
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved_member() then raise exception 'account not approved'; end if;

  plain_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.ingest_keys(user_id, token_hash, updated_at)
  values (uid, encode(extensions.digest(plain_token, 'sha256'), 'hex'), now())
  on conflict (user_id) do update
    set token_hash=excluded.token_hash, updated_at=now();

  return plain_token;
end;
$$;

create or replace function public.approve_member(p_user_id uuid, p_approved boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  if p_user_id = auth.uid() and p_approved = false then raise exception 'owner cannot revoke self'; end if;

  update public.app_members
  set approved=p_approved,
      approved_at=case when p_approved then now() else null end
  where user_id=p_user_id and role <> 'owner';
end;
$$;

revoke all on function public.approve_member(uuid,boolean) from public, anon;
grant execute on function public.approve_member(uuid,boolean) to authenticated;
