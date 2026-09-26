revoke all on function public.collector_ingest_events_service(uuid,uuid,jsonb) from service_role;

create or replace function public.collector_ingest_events_service(
  p_node_id uuid,
  p_job_id uuid,
  p_attempt integer,
  p_events jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, collector_private, extensions
as $$
begin
  if p_attempt is null or p_attempt < 1 then
    raise exception 'invalid leased job';
  end if;

  if not exists (
    select 1
    from collector_private.collector_jobs j
    join public.broker_connections b on b.id=j.connection_id
    where j.id=p_job_id
      and j.status='LEASED'
      and j.leased_by=p_node_id
      and j.attempt=p_attempt
      and b.enabled
  ) then
    raise exception 'invalid leased job';
  end if;

  return public.collector_ingest_events_service(p_node_id,p_job_id,p_events);
end
$$;

revoke all on function public.collector_ingest_events_service(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.collector_ingest_events_service(uuid,uuid,integer,jsonb) to service_role;

revoke all on function public.collector_report_job_service(uuid,uuid,boolean,text) from service_role;

create or replace function public.collector_report_job_service(
  p_node_id uuid,
  p_job_id uuid,
  p_attempt integer,
  p_success boolean,
  p_error_code text default null,
  p_sync_until_ms bigint default null
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
  v_last_sync_at timestamptz;
  v_sync_until timestamptz;
begin
  if p_attempt is null or p_attempt < 1 then
    return false;
  end if;

  select j.connection_id,j.job_type,j.attempt,b.enabled,b.last_sync_at
  into v_connection_id,v_job_type,v_attempt,v_enabled,v_last_sync_at
  from collector_private.collector_jobs j
  join public.broker_connections b on b.id=j.connection_id
  where j.id=p_job_id
    and j.status='LEASED'
    and j.leased_by=p_node_id
    and j.attempt=p_attempt
  for update of j;

  if v_connection_id is null then
    return false;
  end if;

  if coalesce(p_success,false) then
    if v_job_type='SYNC' then
      if p_sync_until_ms is null or p_sync_until_ms <= 0 then
        return false;
      end if;
      v_sync_until := to_timestamp(p_sync_until_ms::numeric/1000.0);
      if v_sync_until > now() + interval '5 minutes' then
        return false;
      end if;
      if v_last_sync_at is not null and v_sync_until < v_last_sync_at then
        return false;
      end if;
    end if;

    update collector_private.collector_jobs
    set status='SUCCEEDED',
        lease_until=null,
        leased_by=null,
        finished_at=now(),
        last_error_code=null
    where id=p_job_id
      and attempt=p_attempt;

    update public.broker_connections
    set state='CONNECTED',
        last_sync_at=case when v_job_type='SYNC' then v_sync_until else last_sync_at end,
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
    where id=p_job_id
      and attempt=p_attempt;

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
  where id=p_job_id
    and attempt=p_attempt;

  update public.broker_connections
  set state='ERROR',
      last_error_code=left(coalesce(nullif(p_error_code,''),'COLLECTOR_ERROR'),128),
      last_error_at=now(),
      updated_at=now()
  where id=v_connection_id;

  return true;
end
$$;

revoke all on function public.collector_report_job_service(uuid,uuid,integer,boolean,text,bigint) from public,anon,authenticated;
grant execute on function public.collector_report_job_service(uuid,uuid,integer,boolean,text,bigint) to service_role;
