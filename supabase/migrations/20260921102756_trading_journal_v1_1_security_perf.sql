drop policy if exists "manage own ingest key" on public.ingest_keys;
create policy "manage own ingest key" on public.ingest_keys
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "read own raw events" on public.raw_events;
create policy "read own raw events" on public.raw_events
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "read own notes" on public.trade_notes;
create policy "read own notes" on public.trade_notes
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "insert own notes" on public.trade_notes;
create policy "insert own notes" on public.trade_notes
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "update own notes" on public.trade_notes;
create policy "update own notes" on public.trade_notes
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "delete own notes" on public.trade_notes;
create policy "delete own notes" on public.trade_notes
for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "read own settings" on public.user_settings;
create policy "read own settings" on public.user_settings
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "insert own settings" on public.user_settings;
create policy "insert own settings" on public.user_settings
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "update own settings" on public.user_settings;
create policy "update own settings" on public.user_settings
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

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
  plain_token := encode(gen_random_bytes(32), 'hex');
  insert into public.ingest_keys(user_id, token_hash, updated_at)
  values (uid, encode(digest(plain_token, 'sha256'), 'hex'), now())
  on conflict (user_id) do update
    set token_hash = excluded.token_hash, updated_at = now();
  return plain_token;
end;
$$;
revoke all on function public.create_or_rotate_ingest_token() from public, anon;
grant execute on function public.create_or_rotate_ingest_token() to authenticated;

revoke all on function public.ingest_mt_events(text,jsonb) from public, authenticated;
grant execute on function public.ingest_mt_events(text,jsonb) to anon;
