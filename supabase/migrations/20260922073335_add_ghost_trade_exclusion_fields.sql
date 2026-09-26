    alter table public.trade_notes
      add column if not exists excluded_from_stats boolean not null default false,
      add column if not exists exclusion_reason text;

    comment on column public.trade_notes.excluded_from_stats is
      'When true, the logical trade remains in history but is excluded from journal P&L, win rate, drawdown and all analytics.';
    comment on column public.trade_notes.exclusion_reason is
      'Optional reason why a logical trade is excluded from analytics, e.g. accidental EA re-entry.';
  