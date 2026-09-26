create table if not exists public.access_blocks (
  email text primary key,
  blocked_until timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.access_blocks enable row level security;

drop policy if exists "owner read access blocks" on public.access_blocks;
create policy "owner read access blocks" on public.access_blocks
for select to authenticated
using (public.is_owner());

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wait_until timestamptz;
begin
  select blocked_until into wait_until
  from public.access_blocks
  where email = lower(coalesce(new.email,''))
    and blocked_until > now();

  if wait_until is not null then
    raise exception 'signup temporarily blocked';
  end if;

  insert into public.app_members(user_id,email,role,approved)
  values (new.id, coalesce(new.email,''), 'member', false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function public.signup_wait_seconds(p_email text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    0,
    coalesce(
      ceil(extract(epoch from (blocked_until - now())))::integer,
      0
    )
  )
  from (
    select blocked_until
    from public.access_blocks
    where email = lower(coalesce(p_email,''))
      and blocked_until > now()
    limit 1
  ) q
  union all
  select 0
  where not exists (
    select 1 from public.access_blocks
    where email = lower(coalesce(p_email,''))
      and blocked_until > now()
  )
  limit 1;
$$;

revoke all on function public.signup_wait_seconds(text) from public;
grant execute on function public.signup_wait_seconds(text) to anon, authenticated;

create or replace function public.decline_member(p_user_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_email text;
  target_role text;
  target_approved boolean;
begin
  if not public.is_owner() then
    raise exception 'owner only';
  end if;

  select lower(email), role, approved
  into target_email, target_role, target_approved
  from public.app_members
  where user_id = p_user_id;

  if target_email is null then
    raise exception 'member not found';
  end if;
  if target_role = 'owner' then
    raise exception 'owner cannot be declined';
  end if;
  if target_approved then
    raise exception 'approved member must be revoked, not declined';
  end if;

  if p_mode = 'block_5m' then
    insert into public.access_blocks(email, blocked_until, created_by, created_at)
    values (target_email, now() + interval '5 minutes', auth.uid(), now())
    on conflict (email) do update
      set blocked_until = excluded.blocked_until,
          created_by = excluded.created_by,
          created_at = now();
  elsif p_mode = 'remove' then
    delete from public.access_blocks where email = target_email;
  else
    raise exception 'invalid decline mode';
  end if;

  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.decline_member(uuid,text) from public, anon;
grant execute on function public.decline_member(uuid,text) to authenticated;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
