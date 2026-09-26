create or replace function collector_private.canonical_ingest_mt_event(
  p_user_id uuid,
  p_event jsonb,
  p_forced_source text default null,
  p_forced_account text default null,
  p_forced_server text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, collector_private, extensions
as $$
declare
  e jsonb := p_event;
  raw_e jsonb;
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
  dk text;
  inserted integer := 0;
begin
  if p_user_id is null or jsonb_typeof(e) <> 'object' then return false; end if;

  if p_forced_source is null then
    src := upper(coalesce(e->>'source',''));
  else
    src := upper(btrim(p_forced_source));
    if coalesce(btrim(e->>'source'),'') <> ''
       and upper(btrim(e->>'source')) <> src then return false; end if;
  end if;

  if p_forced_account is null then
    acct := btrim(coalesce(e->>'account',''));
  else
    acct := btrim(p_forced_account);
    if coalesce(btrim(e->>'account'),'') <> ''
       and btrim(e->>'account') <> acct then return false; end if;
  end if;

  if p_forced_server is null then
    srv := left(coalesce(e->>'server',''),128);
  else
    srv := left(p_forced_server,128);
    if coalesce(btrim(e->>'server'),'') <> ''
       and btrim(e->>'server') <> srv then return false; end if;
  end if;

  eid := btrim(coalesce(e->>'event_id',''));
  sym := upper(btrim(coalesce(e->>'symbol','')));
  sd := upper(btrim(coalesce(e->>'side','')));
  etype := upper(left(coalesce(e->>'entry_type',''),32));
  is_cash := etype in ('BALANCE','CREDIT');

  if src not in ('MT4','MT5') then return false; end if;
  if acct='' or length(acct)>64 or eid='' or length(eid)>128 then return false; end if;

  event_ms := nullif(e->>'event_time_ms','')::bigint;
  open_ms := nullif(e->>'open_time_ms','')::bigint;
  close_ms := nullif(e->>'close_time_ms','')::bigint;

  pnl := coalesce(nullif(e->>'profit','')::numeric,0);
  comm := coalesce(nullif(e->>'commission','')::numeric,0);
  swp := coalesce(nullif(e->>'swap','')::numeric,0);
  fee_n := coalesce(nullif(e->>'fee','')::numeric,0);

  if is_cash then
    if src <> 'MT4' or event_ms is null then return false; end if;
    sym := 'CASH';
    sd := null;
    vol := 0;
    px := null;
    open_px := null;
    close_px := null;
  else
    if sym='' or length(sym)>32 or sd not in ('BUY','SELL') then return false; end if;
    vol := nullif(e->>'volume','')::numeric;
    if vol is null or vol <= 0 or vol > 100000 then return false; end if;

    if src='MT4' and (open_ms is null or close_ms is null) then return false; end if;
    if src='MT5' and event_ms is null then return false; end if;

    px := nullif(e->>'price','')::numeric;
    open_px := nullif(e->>'open_price','')::numeric;
    close_px := nullif(e->>'close_price','')::numeric;
  end if;

  dk := src || '|' || acct || '|' || srv || '|' || eid || '|' ||
        coalesce(event_ms::text, close_ms::text, '');

  raw_e := case
    when p_forced_source is not null or p_forced_account is not null or p_forced_server is not null
      then e || jsonb_build_object('source',src,'account',acct,'server',srv)
    else e
  end;

  insert into public.raw_events(
    user_id,dedupe_key,source,account,server,event_id,order_id,position_id,
    event_time,event_time_ms,symbol,side,entry_type,volume,price,profit,commission,swap,fee,
    magic,comment,open_time,close_time,open_price,close_price,status,raw
  ) values (
    p_user_id,dk,src,acct,nullif(srv,''),eid,
    left(e->>'order_id',128),left(e->>'position_id',128),
    case when event_ms is not null then to_timestamp(event_ms::numeric/1000.0) else null end,
    event_ms,sym,nullif(sd,''),etype,vol,px,pnl,comm,swp,fee_n,
    left(e->>'magic',64),left(e->>'comment',1000),
    case when open_ms is not null then to_timestamp(open_ms::numeric/1000.0) else null end,
    case when close_ms is not null then to_timestamp(close_ms::numeric/1000.0) else null end,
    open_px,close_px,upper(left(e->>'status',32)),raw_e
  )
  on conflict (user_id,dedupe_key) do nothing;

  get diagnostics inserted = row_count;
  return inserted = 1;
exception
  when invalid_text_representation
    or numeric_value_out_of_range
    or datetime_field_overflow then
    return false;
end
$$;

revoke all on function collector_private.canonical_ingest_mt_event(uuid,jsonb,text,text,text)
from public,anon,authenticated,service_role;

create or replace function public.ingest_mt_events(p_token text, p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public, collector_private, extensions
as $$
declare
  uid uuid;
  e jsonb;
  n integer := 0;
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
    if collector_private.canonical_ingest_mt_event(uid,e,null,null,null) then
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;

create or replace function public.collector_ingest_events_service(
  p_node_id uuid,
  p_job_id uuid,
  p_events jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, collector_private, extensions
as $$
declare
  uid uuid;
  src text;
  acct text;
  srv text;
  e jsonb;
  n integer := 0;
begin
  select b.user_id,b.platform,b.login,b.server
  into uid,src,acct,srv
  from collector_private.collector_jobs j
  join public.broker_connections b on b.id=j.connection_id
  where j.id=p_job_id
    and j.status='LEASED'
    and j.leased_by=p_node_id
    and j.lease_until is not null
    and j.lease_until >= now()
    and b.enabled
  for update of j;

  if uid is null then raise exception 'invalid leased job'; end if;
  if jsonb_typeof(p_events) <> 'array' then raise exception 'events must be an array'; end if;
  if jsonb_array_length(p_events) > 200 then raise exception 'batch too large'; end if;
  if octet_length(p_events::text) > 1000000 then raise exception 'payload too large'; end if;

  for e in select * from jsonb_array_elements(p_events)
  loop
    if collector_private.canonical_ingest_mt_event(uid,e,src,acct,srv) then
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;
