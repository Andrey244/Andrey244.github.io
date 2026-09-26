create table if not exists public.daily_reviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  review_date date not null,
  what_worked text,
  what_wrong text,
  tomorrow_focus text,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (user_id, review_date)
);

alter table public.daily_reviews enable row level security;

drop policy if exists "daily reviews read own" on public.daily_reviews;
create policy "daily reviews read own" on public.daily_reviews
for select to authenticated
using (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "daily reviews insert own" on public.daily_reviews;
create policy "daily reviews insert own" on public.daily_reviews
for insert to authenticated
with check (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "daily reviews update own" on public.daily_reviews;
create policy "daily reviews update own" on public.daily_reviews
for update to authenticated
using (user_id=auth.uid() and public.is_approved_member())
with check (user_id=auth.uid() and public.is_approved_member());

drop policy if exists "daily reviews delete own" on public.daily_reviews;
create policy "daily reviews delete own" on public.daily_reviews
for delete to authenticated
using (user_id=auth.uid() and public.is_approved_member());
