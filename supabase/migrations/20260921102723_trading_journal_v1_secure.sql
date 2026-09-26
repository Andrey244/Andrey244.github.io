-- Zero-cost Trading Journal database for Supabase
create extension if not exists pgcrypto;

create table if not exists public.ingest_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.raw_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  received_at timestamptz not null default now(),
  source text not null,
  account text not null,
  server text,
  event_id text not null,
  order_id text,
  position_id text,
  event_time timestamptz,
  event_time_ms bigint,
  symbol text,
  side text,
  entry_type text,
  volume numeric,
  price numeric,
  profit numeric default 0,
  commission numeric default 0,
  swap numeric default 0,
  fee numeric default 0,
  magic text,
  comment text,
  open_time timestamptz,
  close_time timestamptz,
  open_price numeric,
  close_price numeric,
  status text,
  raw jsonb not null default '{}'::jsonb,
  unique(user_id, dedupe_key)
);
create index if not exists raw_events_user_time_idx on public.raw_events(user_id, event_time desc);
create index if not exists raw_events_user_symbol_idx on public.raw_events(user_id, symbol);

create table if not exists public.trade_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id text not null,
  setup text,
  tags text,
  tier text,
  session text,
  confirmation text,
  dxy_state text,
  us2y_state text,
  news_context text,
  probability numeric,
  cr_value numeric,
  plan_ok text,
  mistake text,
  notes text,
  risk_amount numeric,
  screenshot_before text,
  screenshot_after text,
  updated_at timestamptz not null default now(),
  primary key(user_id, trade_id)
);
alter table public.trade_notes add column if not exists tier text;
alter table public.trade_notes add column if not exists session text;
alter table public.trade_notes add column if not exists confirmation text;
alter table public.trade_notes add column if not exists dxy_state text;
alter table public.trade_notes add column if not exists us2y_state text;
alter table public.trade_notes add column if not exists news_context text;
alter table public.trade_notes add column if not exists probability numeric;
alter table public.trade_notes add column if not exists cr_value numeric;

create table if not exists public.user_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value text,
  primary key(user_id, key)
);

alter table public.ingest_keys enable row level security;
alter table public.raw_events enable row level security;
alter table public.trade_notes enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "read own raw events" on public.raw_events;
create policy "read own raw events" on public.raw_events for select to authenticated using (auth.uid() = user_id);

drop policy if exists "read own notes" on public.trade_notes;
create policy "read own notes" on public.trade_notes for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own notes" on public.trade_notes;
create policy "insert own notes" on public.trade_notes for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "update own notes" on public.trade_notes;
create policy "update own notes" on public.trade_notes for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "delete own notes" on public.trade_notes;
create policy "delete own notes" on public.trade_notes for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "read own settings" on public.user_settings;
create policy "read own settings" on public.user_settings for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own settings" on public.user_settings;
create policy "insert own settings" on public.user_settings for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "update own settings" on public.user_settings;
create policy "update own settings" on public.user_settings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.create_or_rotate_ingest_token()
returns text
language plpgsql
security definer
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
  on conflict (user_id) do update set token_hash = excluded.token_hash, updated_at = now();
  return plain_token;
end;
$$;
revoke all on function public.create_or_rotate_ingest_token() from public;
grant execute on function public.create_or_rotate_ingest_token() to authenticated;

create or replace function public.ingest_mt_events(p_token text, p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  e jsonb;
  n integer := 0;
  dk text;
  src text;
  acct text;
  eid text;
begin
  select user_id into uid
  from public.ingest_keys
  where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex');

  if uid is null then raise exception 'invalid ingest token'; end if;
  if jsonb_typeof(p_events) <> 'array' then raise exception 'p_events must be an array'; end if;

  for e in select * from jsonb_array_elements(p_events)
  loop
    src := upper(coalesce(e->>'source',''));
    acct := coalesce(e->>'account','');
    eid := coalesce(e->>'event_id','');
    if src not in ('MT4','MT5') or acct = '' or eid = '' then continue; end if;

    dk := coalesce(nullif(e->>'dedupe_key',''),
      src || '|' || acct || '|' || eid || '|' || coalesce(e->>'event_time_ms', e->>'close_time_ms', ''));

    insert into public.raw_events(
      user_id,dedupe_key,source,account,server,event_id,order_id,position_id,
      event_time,event_time_ms,symbol,side,entry_type,volume,price,profit,commission,swap,fee,
      magic,comment,open_time,close_time,open_price,close_price,status,raw
    ) values (
      uid, dk, src, acct, e->>'server', eid, e->>'order_id', e->>'position_id',
      case when nullif(e->>'event_time_ms','') is not null then to_timestamp((e->>'event_time_ms')::numeric/1000.0) else null end,
      nullif(e->>'event_time_ms','')::bigint,
      e->>'symbol', upper(e->>'side'), upper(e->>'entry_type'),
      nullif(e->>'volume','')::numeric, nullif(e->>'price','')::numeric,
      coalesce(nullif(e->>'profit','')::numeric,0), coalesce(nullif(e->>'commission','')::numeric,0),
      coalesce(nullif(e->>'swap','')::numeric,0), coalesce(nullif(e->>'fee','')::numeric,0),
      e->>'magic', e->>'comment',
      case when nullif(e->>'open_time_ms','') is not null then to_timestamp((e->>'open_time_ms')::numeric/1000.0) else null end,
      case when nullif(e->>'close_time_ms','') is not null then to_timestamp((e->>'close_time_ms')::numeric/1000.0) else null end,
      nullif(e->>'open_price','')::numeric, nullif(e->>'close_price','')::numeric,
      e->>'status', e
    ) on conflict (user_id,dedupe_key) do nothing;

    if found then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.ingest_mt_events(text,jsonb) from public;
grant execute on function public.ingest_mt_events(text,jsonb) to anon, authenticated;