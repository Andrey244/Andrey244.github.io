create or replace function public.create_or_rotate_ingest_token()
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid;
  plain_token text;
begin
  uid := auth.uid();
  if uid is null then raise exception 'not authenticated'; end if;

  plain_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.ingest_keys(user_id, token_hash, updated_at)
  values (
    uid,
    encode(extensions.digest(plain_token, 'sha256'), 'hex'),
    now()
  )
  on conflict (user_id) do update
    set token_hash = excluded.token_hash,
        updated_at = now();

  return plain_token;
end;
$$;