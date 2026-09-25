
alter table collector_private.collector_nodes
  add column if not exists is_primary boolean not null default false;

create unique index if not exists collector_nodes_one_primary_idx
  on collector_private.collector_nodes ((is_primary))
  where is_primary;

create or replace function public.collector_active_public_key_service()
returns table(key_id text, public_key_pem text, algorithm text)
language sql
security definer
set search_path = public, collector_private, extensions
as $$
  select n.key_id, n.public_key_pem, 'RSA-OAEP-SHA256'::text
  from collector_private.collector_nodes n
  where n.enabled and n.is_primary
  order by n.updated_at desc
  limit 1
$$;

create or replace function public.broker_connect_service(
  p_user_id uuid,
  p_platform text,
  p_login text,
  p_server text,
  p_key_id text,
  p_ciphertext_base64 text
)
returns uuid
language plpgsql
security definer
set search_path = public, collector_private, extensions
as $$
declare
  v_connection_id uuid;
  v_ciphertext bytea;
  v_platform text := upper(btrim(coalesce(p_platform,'')));
  v_login text := btrim(coalesce(p_login,''));
  v_server text := btrim(coalesce(p_server,''));
begin
  if p_user_id is null then raise exception 'user required'; end if;
  if not exists (
    select 1 from public.app_members m
    where m.user_id=p_user_id and m.approved
  ) then
    raise exception 'member not approved';
  end if;

  if v_platform not in ('MT4','MT5') then raise exception 'invalid platform'; end if;
  if v_login='' or length(v_login)>64 then raise exception 'invalid login'; end if;
  if v_server='' or length(v_server)>128 then raise exception 'invalid server'; end if;
  if p_key_id is null or length(p_key_id)>128 then raise exception 'invalid key id'; end if;

  if not exists (
    select 1
    from collector_private.collector_nodes n
    where n.enabled and n.is_primary and n.key_id=p_key_id
  ) then
    raise exception 'collector key unavailable';
  end if;

  begin
    v_ciphertext := decode(p_ciphertext_base64,'base64');
  exception when others then
    raise exception 'invalid ciphertext';
  end;

  if octet_length(v_ciphertext) <> 384 then
    raise exception 'invalid ciphertext length';
  end if;

  insert into public.broker_connections(
    user_id, platform, login, server, state, collector_key_id,
    last_sync_at, last_error_code, last_error_at, enabled, updated_at
  ) values (
    p_user_id, v_platform, v_login, v_server, 'PENDING_VALIDATION', p_key_id,
    null, null, null, true, now()
  )
  on conflict (user_id, platform, login, server)
  do update set
    state='PENDING_VALIDATION',
    collector_key_id=excluded.collector_key_id,
    last_error_code=null,
    last_error_at=null,
    enabled=true,
    updated_at=now()
  returning id into v_connection_id;

  insert into collector_private.broker_credentials(
    connection_id,key_id,algorithm,ciphertext,created_at,rotated_at
  ) values (
    v_connection_id,p_key_id,'RSA-OAEP-SHA256',v_ciphertext,now(),null
  )
  on conflict (connection_id)
  do update set
    key_id=excluded.key_id,
    algorithm=excluded.algorithm,
    ciphertext=excluded.ciphertext,
    rotated_at=now();

  update collector_private.collector_jobs
  set status='CANCELLED', lease_until=null, leased_by=null, finished_at=now()
  where connection_id=v_connection_id
    and status in ('QUEUED','LEASED');

  insert into collector_private.collector_jobs(
    connection_id,job_type,status,attempt,scheduled_at
  ) values (
    v_connection_id,'VALIDATE','QUEUED',0,now()
  );

  return v_connection_id;
end
$$;

create or replace function public.broker_disconnect_service(
  p_user_id uuid,
  p_connection_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, collector_private, extensions
as $$
begin
  if not exists (
    select 1 from public.broker_connections b
    where b.id=p_connection_id and b.user_id=p_user_id
  ) then
    return false;
  end if;

  update collector_private.collector_jobs
  set status='CANCELLED', lease_until=null, leased_by=null, finished_at=now()
  where connection_id=p_connection_id
    and status in ('QUEUED','LEASED');

  delete from collector_private.broker_credentials
  where connection_id=p_connection_id;

  update public.broker_connections
  set enabled=false,
      state='DISCONNECTED',
      last_error_code=null,
      last_error_at=null,
      updated_at=now()
  where id=p_connection_id and user_id=p_user_id;

  return found;
end
$$;

create or replace function public.collector_authenticate_service(
  p_token_hash text
)
returns table(node_id uuid, key_id text)
language plpgsql
security definer
set search_path = public, collector_private, extensions
as $$
begin
  if p_token_hash is null
     or length(p_token_hash) <> 64
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  return query
  update collector_private.collector_nodes n
  set last_seen=now(), updated_at=now()
  where n.enabled and n.auth_token_hash=p_token_hash
  returning n.id, n.key_id;
end
$$;

create or replace function public.collector_lease_job_service(
  p_node_id uuid
)
returns table(
  job_id uuid,
  connection_id uuid,
  job_type text,
  platform text,
  login text,
  server text,
  key_id text,
  ciphertext_base64 text,
  attempt integer,
  lease_until timestamptz
)
language plpgsql
security definer
set search_path = public, collector_private, extensions
as $$
declare
  v_job_id uuid;
  v_job_type text;
begin
  if not exists (
    select 1 from collector_private.collector_nodes n
    where n.id=p_node_id and n.enabled
  ) then
    return;
  end if;

  update collector_private.collector_jobs
  set status='QUEUED',
      leased_by=null,
      lease_until=null,
      scheduled_at=now(),
      last_error_code='LEASE_EXPIRED'
  where status='LEASED'
    and lease_until < now()
    and attempt < 6;

  update collector_private.collector_jobs
  set status='FAILED',
      leased_by=null,
      lease_until=null,
      finished_at=now(),
      last_error_code='LEASE_EXPIRED_MAX_RETRIES'
  where status='LEASED'
    and lease_until < now()
    and attempt >= 6;

  select j.id,j.job_type
  into v_job_id,v_job_type
  from collector_private.collector_jobs j
  join public.broker_connections b on b.id=j.connection_id
  join collector_private.broker_credentials c on c.connection_id=b.id
  join collector_private.collector_nodes n on n.id=p_node_id
  where j.status='QUEUED'
    and j.scheduled_at <= now()
    and j.attempt < 6
    and b.enabled
    and n.enabled
    and n.key_id=c.key_id
  order by case when j.job_type='VALIDATE' then 0 else 1 end,
           j.scheduled_at,
           j.created_at
  for update of j skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  update collector_private.collector_jobs
  set status='LEASED',
      attempt=attempt+1,
      leased_by=p_node_id,
      lease_until=now()+interval '5 minutes',
      last_error_code=null
  where id=v_job_id;

  if v_job_type='VALIDATE' then
    update public.broker_connections
    set state='VALIDATING', updated_at=now()
    where id=(select connection_id from collector_private.collector_jobs where id=v_job_id);
  end if;

  return query
  select
    j.id,
    b.id,
    j.job_type,
    b.platform,
    b.login,
    b.server,
    c.key_id,
    encode(c.ciphertext,'base64'),
    j.attempt,
    j.lease_until
  from collector_private.collector_jobs j
  join public.broker_connections b on b.id=j.connection_id
  join collector_private.broker_credentials c on c.connection_id=b.id
  where j.id=v_job_id;
end
$$;

create or replace function public.collector_report_job_service(
  p_node_id uuid,
  p_job_id uuid,
  p_success boolean,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, collector_private, extensions
as $$
declare
  v_connection_id uuid;
  v_job_type text;
  v_attempt integer;
  v_enabled boolean;
  v_delay_seconds integer;
begin
  select j.connection_id,j.job_type,j.attempt,b.enabled
  into v_connection_id,v_job_type,v_attempt,v_enabled
  from collector_private.collector_jobs j
  join public.broker_connections b on b.id=j.connection_id
  where j.id=p_job_id
    and j.status='LEASED'
    and j.leased_by=p_node_id
  for update of j;

  if v_connection_id is null then
    return false;
  end if;

  if coalesce(p_success,false) then
    update collector_private.collector_jobs
    set status='SUCCEEDED', lease_until=null, finished_at=now(), last_error_code=null
    where id=p_job_id;

    update public.broker_connections
    set state='CONNECTED',
        last_sync_at=now(),
        last_error_code=null,
        last_error_at=null,
        updated_at=now()
    where id=v_connection_id;

    if v_enabled then
      insert into collector_private.collector_jobs(
        connection_id,job_type,status,attempt,scheduled_at
      ) values (
        v_connection_id,
        'SYNC',
        'QUEUED',
        0,
        now() + case when v_job_type='VALIDATE' then interval '1 second' else interval '30 seconds' end
      );
    end if;

    return true;
  end if;

  if v_enabled and v_attempt < 6 then
    v_delay_seconds := least(900, (30 * power(2,least(v_attempt,5)))::integer);

    update collector_private.collector_jobs
    set status='QUEUED',
        leased_by=null,
        lease_until=null,
        scheduled_at=now()+make_interval(secs=>v_delay_seconds),
        last_error_code=left(coalesce(nullif(p_error_code,''),'COLLECTOR_ERROR'),128)
    where id=p_job_id;

    update public.broker_connections
    set state=case when v_job_type='VALIDATE' then 'ERROR' else 'DEGRADED' end,
        last_error_code=left(coalesce(nullif(p_error_code,''),'COLLECTOR_ERROR'),128),
        last_error_at=now(),
        updated_at=now()
    where id=v_connection_id;

    return true;
  end if;

  update collector_private.collector_jobs
  set status='FAILED',
      leased_by=null,
      lease_until=null,
      finished_at=now(),
      last_error_code=left(coalesce(nullif(p_error_code,''),'COLLECTOR_ERROR'),128)
  where id=p_job_id;

  update public.broker_connections
  set state='ERROR',
      last_error_code=left(coalesce(nullif(p_error_code,''),'COLLECTOR_ERROR'),128),
      last_error_at=now(),
      updated_at=now()
  where id=v_connection_id;

  return true;
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
  dk text;
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
  select b.user_id,b.platform,b.login,b.server
  into uid,src,acct,srv
  from collector_private.collector_jobs j
  join public.broker_connections b on b.id=j.connection_id
  where j.id=p_job_id
    and j.status='LEASED'
    and j.leased_by=p_node_id
    and b.enabled
  for update of j;

  if uid is null then raise exception 'invalid leased job'; end if;
  if jsonb_typeof(p_events) <> 'array' then raise exception 'events must be an array'; end if;
  if jsonb_array_length(p_events) > 200 then raise exception 'batch too large'; end if;
  if octet_length(p_events::text) > 1000000 then raise exception 'payload too large'; end if;

  for e in select * from jsonb_array_elements(p_events)
  loop
    begin
      if jsonb_typeof(e) <> 'object' then continue; end if;

      if coalesce(btrim(e->>'source'),'') <> ''
         and upper(btrim(e->>'source')) <> src then continue; end if;
      if coalesce(btrim(e->>'account'),'') <> ''
         and btrim(e->>'account') <> acct then continue; end if;
      if coalesce(btrim(e->>'server'),'') <> ''
         and btrim(e->>'server') <> srv then continue; end if;

      eid := btrim(coalesce(e->>'event_id',''));
      sym := upper(btrim(coalesce(e->>'symbol','')));
      sd := upper(btrim(coalesce(e->>'side','')));
      etype := upper(left(coalesce(e->>'entry_type',''),32));
      is_cash := etype in ('BALANCE','CREDIT');

      if eid='' or length(eid)>128 then continue; end if;

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

      e := e || jsonb_build_object('source',src,'account',acct,'server',srv);

      insert into public.raw_events(
        user_id,dedupe_key,source,account,server,event_id,order_id,position_id,
        event_time,event_time_ms,symbol,side,entry_type,volume,price,profit,commission,swap,fee,
        magic,comment,open_time,close_time,open_price,close_price,status,raw
      ) values (
        uid,dk,src,acct,srv,eid,
        left(e->>'order_id',128),left(e->>'position_id',128),
        case when event_ms is not null then to_timestamp(event_ms::numeric/1000.0) else null end,
        event_ms,sym,nullif(sd,''),etype,vol,px,pnl,comm,swp,fee_n,
        left(e->>'magic',64),left(e->>'comment',1000),
        case when open_ms is not null then to_timestamp(open_ms::numeric/1000.0) else null end,
        case when close_ms is not null then to_timestamp(close_ms::numeric/1000.0) else null end,
        open_px,close_px,upper(left(e->>'status',32)),e
      )
      on conflict (user_id,dedupe_key) do nothing;

      if found then n := n + 1; end if;
    exception
      when invalid_text_representation
        or numeric_value_out_of_range
        or datetime_field_overflow then
        continue;
    end;
  end loop;

  return n;
end
$$;

revoke all on function public.collector_active_public_key_service() from public,anon,authenticated;
revoke all on function public.broker_connect_service(uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.broker_disconnect_service(uuid,uuid) from public,anon,authenticated;
revoke all on function public.collector_authenticate_service(text) from public,anon,authenticated;
revoke all on function public.collector_lease_job_service(uuid) from public,anon,authenticated;
revoke all on function public.collector_report_job_service(uuid,uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.collector_ingest_events_service(uuid,uuid,jsonb) from public,anon,authenticated;

grant execute on function public.collector_active_public_key_service() to service_role;
grant execute on function public.broker_connect_service(uuid,text,text,text,text,text) to service_role;
grant execute on function public.broker_disconnect_service(uuid,uuid) to service_role;
grant execute on function public.collector_authenticate_service(text) to service_role;
grant execute on function public.collector_lease_job_service(uuid) to service_role;
grant execute on function public.collector_report_job_service(uuid,uuid,boolean,text) to service_role;
grant execute on function public.collector_ingest_events_service(uuid,uuid,jsonb) to service_role;
