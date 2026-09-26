create or replace function public.collector_active_public_key_service()
returns table(key_id text, public_key_pem text, algorithm text)
language sql
security definer
set search_path = public, collector_private, extensions
as $$
  select n.key_id, n.public_key_pem, 'RSA-OAEP-SHA256'::text
  from collector_private.collector_nodes n
  where n.enabled
    and n.is_primary
    and n.last_seen is not null
    and n.last_seen >= now() - interval '2 minutes'
  order by n.last_seen desc, n.updated_at desc
  limit 1
$$;

revoke all on function public.collector_active_public_key_service() from public,anon,authenticated;
grant execute on function public.collector_active_public_key_service() to service_role;
