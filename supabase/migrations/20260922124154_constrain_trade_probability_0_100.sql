    do $$
    begin
      if not exists (
        select 1 from pg_constraint
        where conname='trade_notes_probability_range_chk'
          and conrelid='public.trade_notes'::regclass
      ) then
        alter table public.trade_notes
          add constraint trade_notes_probability_range_chk
          check (probability is null or (probability >= 0 and probability <= 100));
      end if;
    end $$;
  