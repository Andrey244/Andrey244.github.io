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

  update collector_private.collector_jobs as j
  set status='QUEUED',
      leased_by=null,
      lease_until=null,
      scheduled_at=now(),
      last_error_code='LEASE_EXPIRED'
  where j.status='LEASED'
    and j.lease_until < now()
    and j.attempt < 6;

  with failed as (
    update collector_private.collector_jobs as j
    set status='FAILED',
        leased_by=null,
        lease_until=null,
        finished_at=now(),
        last_error_code='LEASE_EXPIRED_MAX_RETRIES'
    where j.status='LEASED'
      and j.lease_until < now()
      and j.attempt >= 6
    returning j.connection_id,j.job_type
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

  update collector_private.collector_jobs as j
  set status='LEASED',
      attempt=j.attempt+1,
      leased_by=p_node_id,
      lease_until=now()+interval '5 minutes',
      last_error_code=null
  where j.id=v_job_id;

  if v_job_type='VALIDATE' then
    update public.broker_connections as b
    set state='VALIDATING', updated_at=now()
    where b.id=(
      select j.connection_id
      from collector_private.collector_jobs j
      where j.id=v_job_id
    );
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

revoke all on function public.collector_lease_job_service(uuid)
from public,anon,authenticated;
grant execute on function public.collector_lease_job_service(uuid)
to service_role;
