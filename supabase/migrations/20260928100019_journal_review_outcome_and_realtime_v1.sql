alter table public.trade_notes add column if not exists reviewed_at timestamptz;
alter table public.trade_notes add column if not exists outcome_override text;

alter table public.trade_notes drop constraint if exists trade_notes_outcome_override_check;
alter table public.trade_notes
  add constraint trade_notes_outcome_override_check
  check (outcome_override is null or outcome_override in ('worked','loss','other'));

update public.trade_notes
set reviewed_at=updated_at
where reviewed_at is null
  and (
    nullif(trim(coalesce(setup,'')),'') is not null or
    nullif(trim(coalesce(tags,'')),'') is not null or
    nullif(trim(coalesce(tier,'')),'') is not null or
    nullif(trim(coalesce(session,'')),'') is not null or
    nullif(trim(coalesce(confirmation,'')),'') is not null or
    nullif(trim(coalesce(dxy_state,'')),'') is not null or
    nullif(trim(coalesce(us2y_state,'')),'') is not null or
    nullif(trim(coalesce(news_context,'')),'') is not null or
    probability is not null or
    cr_value is not null or
    nullif(trim(coalesce(plan_ok,'')),'') is not null or
    nullif(trim(coalesce(mistake,'')),'') is not null or
    nullif(trim(coalesce(notes,'')),'') is not null or
    risk_amount is not null or
    nullif(trim(coalesce(screenshot_before,'')),'') is not null or
    nullif(trim(coalesce(screenshot_after,'')),'') is not null
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='raw_events'
  ) then
    alter publication supabase_realtime add table public.raw_events;
  end if;
end
$$;
