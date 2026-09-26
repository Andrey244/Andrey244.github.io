create table if not exists public.connector_status(
  user_id uuid not null,
  source text not null,
  account text not null,
  server text not null default '',
  version text not null,
  last_seen timestamptz not null default now(),
  primary key(user_id,source,account,server)
);

alter table public.connector_status enable row level security;

drop policy if exists "connector_status_own_select" on public.connector_status;
create policy "connector_status_own_select"
on public.connector_status
for select
to authenticated
using (auth.uid() = user_id);

revoke all on public.connector_status from anon, authenticated;
grant select on public.connector_status to authenticated;

create or replace function public.report_connector_status(
  p_token text,
  p_source text,
  p_account text,
  p_server text,
  p_version text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
  src text := upper(btrim(coalesce(p_source,'')));
  acct text := btrim(coalesce(p_account,''));
  srv text := left(coalesce(p_server,''),128);
  ver text := left(btrim(coalesce(p_version,'')),32);
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 256 then
    raise exception 'invalid ingest token';
  end if;

  select user_id into uid
  from public.ingest_keys
  where token_hash = encode(digest(p_token, 'sha256'), 'hex');

  if uid is null then raise exception 'invalid ingest token'; end if;
  if src not in ('MT4','MT5') then raise exception 'invalid source'; end if;
  if acct='' or length(acct)>64 then raise exception 'invalid account'; end if;
  if ver='' then raise exception 'invalid version'; end if;

  insert into public.connector_status(user_id,source,account,server,version,last_seen)
  values(uid,src,acct,srv,ver,now())
  on conflict(user_id,source,account,server)
  do update set version=excluded.version,last_seen=now();

  return true;
end;
$$;

revoke execute on function public.report_connector_status(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.report_connector_status(text,text,text,text,text) to anon;

create or replace function public.ingest_mt_events(p_token text, p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
  e jsonb;
  n integer := 0;
  dk text;
  src text;
  acct text;
  srv text;
  eid text;
  sym text;
  sd text;
  etype text;
  vol numeric;
  px numeric;
  pnl numeric;
  comm numeric;
  swp numeric;
  fee_n numeric;
  open_px numeric;
  close_px numeric;
  event_ms bigint;
  open_ms bigint;
  close_ms bigint;
  is_cash boolean;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 256 then
    raise exception 'invalid ingest token';
  end if;

  select user_id into uid
  from public.ingest_keys
  where token_hash = encode(digest(p_token, 'sha256'), 'hex');

  if uid is null then raise exception 'invalid ingest token'; end if;
  if jsonb_typeof(p_events) <> 'array' then raise exception 'p_events must be an array'; end if;
  if jsonb_array_length(p_events) > 200 then raise exception 'batch too large'; end if;
  if octet_length(p_events::text) > 1000000 then raise exception 'payload too large'; end if;

  for e in select * from jsonb_array_elements(p_events)
  loop
    begin
      if jsonb_typeof(e) <> 'object' then continue; end if;

      src := upper(coalesce(e->>'source',''));
      acct := btrim(coalesce(e->>'account',''));
      srv := left(coalesce(e->>'server',''),128);
      eid := btrim(coalesce(e->>'event_id',''));
      sym := upper(btrim(coalesce(e->>'symbol','')));
      sd := upper(btrim(coalesce(e->>'side','')));
      etype := upper(left(coalesce(e->>'entry_type',''),32));
      is_cash := etype in ('BALANCE','CREDIT');

      if src not in ('MT4','MT5') then continue; end if;
      if acct='' or length(acct)>64 or eid='' or length(eid)>128 then continue; end if;

      event_ms := nullif(e->>'event_time_ms','')::bigint;
      open_ms := nullif(e->>'open_time_ms','')::bigint;
      close_ms := nullif(e->>'close_time_ms','')::bigint;

      pnl := coalesce(nullif(e->>'profit','')::numeric,0);
      comm := coalesce(nullif(e->>'commission','')::numeric,0);
      swp := coalesce(nullif(e->>'swap','')::numeric,0);
      fee_n := coalesce(nullif(e->>'fee','')::numeric,0);

      if is_cash then
        if src <> 'MT4' then continue; end if;
        if event_ms is null then continue; end if;
        sym := 'CASH';
        sd := null;
        vol := 0;
        px := null;
        open_px := null;
        close_px := null;
      else
        if sym='' or length(sym)>32 or sd not in ('BUY','SELL') then continue; end if;
        vol := nullif(e->>'volume','')::numeric;
        if vol is null or vol <= 0 or vol > 100000 then continue; end if;

        if src='MT4' and (open_ms is null or close_ms is null) then continue; end if;
        if src='MT5' and event_ms is null then continue; end if;

        px := nullif(e->>'price','')::numeric;
        open_px := nullif(e->>'open_price','')::numeric;
        close_px := nullif(e->>'close_price','')::numeric;
      end if;

      dk := src || '|' || acct || '|' || srv || '|' || eid || '|' ||
            coalesce(event_ms::text, close_ms::text, '');

      insert into public.raw_events(
        user_id,dedupe_key,source,account,server,event_id,order_id,position_id,
        event_time,event_time_ms,symbol,side,entry_type,volume,price,profit,commission,swap,fee,
        magic,comment,open_time,close_time,open_price,close_price,status,raw
      ) values (
        uid, dk, src, acct, nullif(srv,''), eid,
        left(e->>'order_id',128), left(e->>'position_id',128),
        case when event_ms is not null then to_timestamp(event_ms::numeric/1000.0) else null end,
        event_ms, sym, nullif(sd,''), etype, vol, px, pnl, comm, swp, fee_n,
        left(e->>'magic',64), left(e->>'comment',1000),
        case when open_ms is not null then to_timestamp(open_ms::numeric/1000.0) else null end,
        case when close_ms is not null then to_timestamp(close_ms::numeric/1000.0) else null end,
        open_px, close_px, upper(left(e->>'status',32)), e
      )
      on conflict (user_id,dedupe_key) do nothing;

      if found then n := n + 1; end if;
    exception
      when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
        continue;
    end;
  end loop;
  return n;
end;
$$;
  