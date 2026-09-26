alter policy "owner read access blocks" on public.access_blocks
  using ((select public.is_owner()));

alter policy "account settings read own" on public.account_settings
  using (((select auth.uid()) = user_id) and (select public.is_approved_member()));
alter policy "account settings insert own" on public.account_settings
  with check (((select auth.uid()) = user_id) and (select public.is_approved_member()));
alter policy "account settings update own" on public.account_settings
  using (((select auth.uid()) = user_id) and (select public.is_approved_member()))
  with check (((select auth.uid()) = user_id) and (select public.is_approved_member()));
alter policy "account settings delete own" on public.account_settings
  using (((select auth.uid()) = user_id) and (select public.is_approved_member()));

alter policy "members read" on public.app_members
  using (((select auth.uid()) = user_id) or (select public.is_admin()));

alter policy "connector_status_own_select" on public.connector_status
  using ((select auth.uid()) = user_id);

alter policy "daily reviews read own" on public.daily_reviews
  using (((select auth.uid()) = user_id) and (select public.is_approved_member()));
alter policy "daily reviews insert own" on public.daily_reviews
  with check (((select auth.uid()) = user_id) and (select public.is_approved_member()));
alter policy "daily reviews update own" on public.daily_reviews
  using (((select auth.uid()) = user_id) and (select public.is_approved_member()))
  with check (((select auth.uid()) = user_id) and (select public.is_approved_member()));
alter policy "daily reviews delete own" on public.daily_reviews
  using (((select auth.uid()) = user_id) and (select public.is_approved_member()));

alter policy "manage own ingest key" on public.ingest_keys
  using (((select auth.uid()) = user_id) and (select public.is_approved_member()))
  with check (((select auth.uid()) = user_id) and (select public.is_approved_member()));

alter policy "read own raw events" on public.raw_events
  using (((select auth.uid()) = user_id) and (select public.is_approved_member()));

alter policy "read own notes" on public.trade_notes
  using (((select auth.uid()) = user_id) and (select public.is_approved_member()));
alter policy "insert own notes" on public.trade_notes
  with check (((select auth.uid()) = user_id) and (select public.is_approved_member()));
alter policy "update own notes" on public.trade_notes
  using (((select auth.uid()) = user_id) and (select public.is_approved_member()))
  with check (((select auth.uid()) = user_id) and (select public.is_approved_member()));
alter policy "delete own notes" on public.trade_notes
  using (((select auth.uid()) = user_id) and (select public.is_approved_member()));

alter policy "read own settings" on public.user_settings
  using (((select auth.uid()) = user_id) and (select public.is_approved_member()));
alter policy "insert own settings" on public.user_settings
  with check (((select auth.uid()) = user_id) and (select public.is_approved_member()));
alter policy "update own settings" on public.user_settings
  using (((select auth.uid()) = user_id) and (select public.is_approved_member()))
  with check (((select auth.uid()) = user_id) and (select public.is_approved_member()));

create index if not exists access_blocks_created_by_idx
  on public.access_blocks(created_by);
