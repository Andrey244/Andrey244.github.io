create or replace function public.enrich_duplicate_raw_event_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.raw_events
  set raw = coalesce(public.raw_events.raw,'{}'::jsonb) || coalesce(new.raw,'{}'::jsonb)
  where user_id = new.user_id
    and dedupe_key = new.dedupe_key;

  if found then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enrich_duplicate_raw_event_metadata on public.raw_events;
create trigger trg_enrich_duplicate_raw_event_metadata
before insert on public.raw_events
for each row
execute function public.enrich_duplicate_raw_event_metadata();

revoke execute on function public.enrich_duplicate_raw_event_metadata() from public, anon, authenticated;
  