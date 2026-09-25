create or replace function public.collector_register_node_service(
  p_name text,
  p_key_id text,
  p_public_key_pem text,
  p_auth_token_hash text,
  p_make_primary boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, collector_private, extensions
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name,''));
  v_key_id text := btrim(coalesce(p_key_id,''));
  v_pem text := btrim(coalesce(p_public_key_pem,''));
  v_hash text := lower(btrim(coalesce(p_auth_token_hash,'')));
begin
  if v_name='' or length(v_name)>120 then raise exception 'invalid collector name'; end if;
  if v_key_id !~ '^rsa3072-sha256-[0-9a-f]{32}$' then raise exception 'invalid collector key id'; end if;
  if length(v_pem)>4096 or position('-----BEGIN PUBLIC KEY-----' in v_pem)<>1
     or position('-----END PUBLIC KEY-----' in v_pem)=0 then
    raise exception 'invalid collector public key';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid collector auth token hash'; end if;

  if coalesce(p_make_primary,true) then
    update collector_private.collector_nodes
    set is_primary=false, updated_at=now()
    where is_primary;
  end if;

  insert into collector_private.collector_nodes(
    name,key_id,public_key_pem,auth_token_hash,enabled,is_primary,last_seen,created_at,updated_at
  ) values (
    v_name,v_key_id,v_pem,v_hash,true,coalesce(p_make_primary,true),null,now(),now()
  )
  on conflict (key_id)
  do update set
    name=excluded.name,
    public_key_pem=excluded.public_key_pem,
    auth_token_hash=excluded.auth_token_hash,
    enabled=true,
    is_primary=excluded.is_primary,
    last_seen=null,
    updated_at=now()
  returning id into v_id;

  return v_id;
end
$$;

revoke all on function public.collector_register_node_service(text,text,text,text,boolean)
from public,anon,authenticated;
grant execute on function public.collector_register_node_service(text,text,text,text,boolean)
to service_role;
