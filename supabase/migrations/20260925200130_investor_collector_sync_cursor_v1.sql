revoke all on function public.collector_lease_job_service(uuid) from public,anon,authenticated,service_role;
drop function public.collector_lease_job_service(uuid);

create function public.collector_lease_job_service(
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
  lease_until timestamptz,
  last_sync_at timestamptz
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

  with failed as (
    update collector_private.collector_jobs
    set status='FAILED',
        leased_by=null,
        lease_until=null,
        finished_at=now(),
        last_error_code='LEASE_EXPIRED_MAX_RETRIES'
    where status='LEASED'
      and lease_until < now()
      and attempt >= 6
    returning connection_id,job_type
  )
  update public.broker_connections b
  set state=case when f.job_type='VALIDATE' then 'ERROR' else 'DEGRADED' end,
      last_error_code='LEASE_EXPIRED_MAX_RETRIES',
      last_error_at=now(),
      updated_at=now()
  from failed f
  where b.id=f.connection_id;

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
    j.lease_until,
    b.last_sync_at
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
        last_sync_at=case when v_job_type='SYNC' then now() else last_sync_at end,
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
    set status='QUEUED', leased_by=null, lease_until=null,
        scheduled_at=now()+make_interval(secs=>v_delay_seconds),
        last_error_code=left(coalesce(nullif(p_error_code,''),'COLLECTOR_ERROR'),128)
    where id=p_job_id;
    update public.broker_connections
    set state=case when v_job_type='VALIDATE' then 'ERROR' else 'DEGRADED' end,
        last_error_code=left(coalesce(nullif(p_error_code,''),'COLLECTOR_ERROR'),128),
        last_error_at=now(), updated_at=now()
    where id=v_connection_id;
    return true;
  end if;

  update collector_private.collector_jobs
  set status='FAILED', leased_by=null, lease_until=null, finished_at=now(),
      last_error_code=left(coalesce(nullif(p_error_code,''),'COLLECTOR_ERROR'),128)
  where id=p_job_id;

  update public.broker_connections
  set state='ERROR',
      last_error_code=left(coalesce(nullif(p_error_code,''),'COLLECTOR_ERROR'),128),
      last_error_at=now(), updated_at=now()
  where id=v_connection_id;
  return true;
end
$$;

revoke all on function public.collector_lease_job_service(uuid) from public,anon,authenticated;
revoke all on function public.collector_report_job_service(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.collector_lease_job_service(uuid) to service_role;
grant execute on function public.collector_report_job_service(uuid,uuid,boolean,text) to service_role;
