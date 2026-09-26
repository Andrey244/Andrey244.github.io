-- Canonicalize existing event identity before tightening ingest.
update public.raw_events
set dedupe_key =
  upper(source) || '|' || account || '|' || coalesce(server,'') || '|' ||
  event_id || '|' || coalesce(event_time_ms::text,'')
where dedupe_key is distinct from
  upper(source) || '|' || account || '|' || coalesce(server,'') || '|' ||
  event_id || '|' || coalesce(event_time_ms::text,'');

-- Basic invariants at the storage layer.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='raw_events_source_chk') then
    alter table public.raw_events add constraint raw_events_source_chk check (source in ('MT4','MT5'));
  end if;
  if not exists (select 1 from pg_constraint where conname='raw_events_account_chk') then
    alter table public.raw_events add constraint raw_events_account_chk check (btrim(account) <> '');
  end if;
  if not exists (select 1 from pg_constraint where conname='raw_events_event_id_chk') then
    alter table public.raw_events add constraint raw_events_event_id_chk check (btrim(event_id) <> '');
  end if;
  if not exists (select 1 from pg_constraint where conname='raw_events_side_chk') then
    alter table public.raw_events add constraint raw_events_side_chk check (side is null or side in ('BUY','SELL'));
  end if;
end $$;

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

      if src not in ('MT4','MT5') then continue; end if;
      if acct='' or length(acct)>64 or eid='' or length(eid)>128 then continue; end if;
      if sym='' or length(sym)>32 or sd not in ('BUY','SELL') then continue; end if;

      vol := nullif(e->>'volume','')::numeric;
      if vol is null or vol <= 0 or vol > 100000 then continue; end if;

      event_ms := nullif(e->>'event_time_ms','')::bigint;
      open_ms := nullif(e->>'open_time_ms','')::bigint;
      close_ms := nullif(e->>'close_time_ms','')::bigint;

      if src='MT4' and (open_ms is null or close_ms is null) then continue; end if;
      if src='MT5' and event_ms is null then continue; end if;

      px := nullif(e->>'price','')::numeric;
      pnl := coalesce(nullif(e->>'profit','')::numeric,0);
      comm := coalesce(nullif(e->>'commission','')::numeric,0);
      swp := coalesce(nullif(e->>'swap','')::numeric,0);
      fee_n := coalesce(nullif(e->>'fee','')::numeric,0);
      open_px := nullif(e->>'open_price','')::numeric;
      close_px := nullif(e->>'close_price','')::numeric;

      -- Never trust a client-supplied dedupe_key.
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
        event_ms, sym, sd, etype, vol, px, pnl, comm, swp, fee_n,
        left(e->>'magic',64), left(e->>'comment',1000),
        case when open_ms is not null then to_timestamp(open_ms::numeric/1000.0) else null end,
        case when close_ms is not null then to_timestamp(close_ms::numeric/1000.0) else null end,
        open_px, close_px, upper(left(e->>'status',32)), e
      )
      on conflict (user_id,dedupe_key) do nothing;

      if found then n := n + 1; end if;
    exception
      when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
        -- One malformed event must not poison the rest of a valid batch.
        continue;
    end;
  end loop;
  return n;
end;
$$;

create or replace function public.create_or_rotate_ingest_token()
returns text
language plpgsql
security definer
set search_path = public, extensions
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

-- Least privilege: exposed clients do not need broad table grants.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select on public.app_members to authenticated;
grant select on public.raw_events to authenticated;
grant select, insert, update, delete on public.account_settings to authenticated;
grant select, insert, update, delete on public.trade_notes to authenticated;
grant select, insert, update on public.user_settings to authenticated;
grant select, insert, update, delete on public.daily_reviews to authenticated;

-- Explicit RPC surface.
revoke execute on function public.ingest_mt_events(text,jsonb) from public, anon, authenticated;
revoke execute on function public.create_or_rotate_ingest_token() from public, anon, authenticated;
revoke execute on function public.signup_wait_seconds(text) from public, anon, authenticated;
revoke execute on function public.approve_member(uuid,boolean) from public, anon, authenticated;
revoke execute on function public.decline_member(uuid,text) from public, anon, authenticated;
revoke execute on function public.is_approved_member() from public, anon, authenticated;
revoke execute on function public.is_owner() from public, anon, authenticated;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

grant execute on function public.ingest_mt_events(text,jsonb) to anon;
grant execute on function public.create_or_rotate_ingest_token() to authenticated;
grant execute on function public.signup_wait_seconds(text) to anon, authenticated;
grant execute on function public.approve_member(uuid,boolean) to authenticated;
grant execute on function public.decline_member(uuid,text) to authenticated;
grant execute on function public.is_approved_member() to authenticated;
grant execute on function public.is_owner() to authenticated;
  