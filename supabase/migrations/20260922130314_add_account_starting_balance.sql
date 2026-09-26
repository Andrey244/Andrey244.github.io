    alter table public.account_settings
      add column if not exists starting_balance numeric;

    do $$
    begin
      if not exists (
        select 1 from pg_constraint
        where conname='account_settings_starting_balance_chk'
          and conrelid='public.account_settings'::regclass
      ) then
        alter table public.account_settings
          add constraint account_settings_starting_balance_chk
          check (starting_balance is null or starting_balance >= 0);
      end if;
    end $$;

    update public.account_settings
    set starting_balance=10000, updated_at=now()
    where user_id='22186e43-5b6b-459a-baaa-ac3a7e3e8271'
      and source='MT4'
      and account='252015075'
      and server='Alpari-Pro.ECN-Demo';
  