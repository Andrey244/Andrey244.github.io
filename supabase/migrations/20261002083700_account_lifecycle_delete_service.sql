create or replace function public.account_delete_data_service(
  p_user_id uuid,
  p_source text,
  p_account text,
  p_server text,
  p_trade_ids text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, collector_private, extensions
as $function$
declare
  v_source text := upper(btrim(coalesce(p_source,'')));
  v_account text := btrim(coalesce(p_account,''));
  v_server text := btrim(coalesce(p_server,''));
  v_raw bigint := 0;
  v_notes bigint := 0;
  v_settings bigint := 0;
  v_status bigint := 0;
begin
  if p_user_id is null then raise exception 'user_required'; end if;
  if not exists (
    select 1 from public.app_members m
    where m.user_id=p_user_id and m.approved
  ) then
    raise exception 'member_not_approved';
  end if;

  if v_source not in ('MT4','MT5') then raise exception 'invalid_source'; end if;
  if v_account='' or length(v_account)>64 then raise exception 'invalid_account'; end if;
  if v_server='' or length(v_server)>128 or v_server ~ '[\r\n]' then raise exception 'invalid_server'; end if;
  if cardinality(coalesce(p_trade_ids,array[]::text[])) > 10000 then raise exception 'too_many_trade_ids'; end if;

  if not exists (
    select 1 from public.account_settings s
    where s.user_id=p_user_id
      and upper(s.source)=v_source
      and s.account=v_account
      and s.server=v_server
      and s.enabled=false
  ) then
    raise exception 'account_not_archived';
  end if;

  if exists (
    select 1 from public.broker_connections b
    where b.user_id=p_user_id
      and upper(b.platform)=v_source
      and b.login=v_account
      and b.server=v_server
      and b.enabled
      and upper(b.state)<>'DISCONNECTED'
  ) then
    raise exception 'active_connection';
  end if;

  if exists (
    select 1 from public.connector_status c
    where c.user_id=p_user_id
      and upper(c.source)=v_source
      and c.account=v_account
      and c.server=v_server
      and c.last_seen > now() - interval '10 minutes'
  ) then
    raise exception 'connector_active';
  end if;

  delete from public.trade_notes n
  where n.user_id=p_user_id
    and n.trade_id = any(coalesce(p_trade_ids,array[]::text[]));
  get diagnostics v_notes = row_count;

  delete from public.raw_events e
  where e.user_id=p_user_id
    and upper(e.source)=v_source
    and e.account=v_account
    and coalesce(e.server,'')=v_server;
  get diagnostics v_raw = row_count;

  delete from public.connector_status c
  where c.user_id=p_user_id
    and upper(c.source)=v_source
    and c.account=v_account
    and c.server=v_server;
  get diagnostics v_status = row_count;

  delete from public.account_settings s
  where s.user_id=p_user_id
    and upper(s.source)=v_source
    and s.account=v_account
    and s.server=v_server;
  get diagnostics v_settings = row_count;

  return jsonb_build_object(
    'raw_events_deleted',v_raw,
    'trade_notes_deleted',v_notes,
    'account_settings_deleted',v_settings,
    'connector_status_deleted',v_status
  );
end
$function$;

revoke all on function public.account_delete_data_service(uuid,text,text,text,text[]) from public;
revoke all on function public.account_delete_data_service(uuid,text,text,text,text[]) from anon;
revoke all on function public.account_delete_data_service(uuid,text,text,text,text[]) from authenticated;
grant execute on function public.account_delete_data_service(uuid,text,text,text,text[]) to service_role;
