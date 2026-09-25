# Trading Journal Collector

Foundation for the owned Windows collector used by direct Investor Password connections.

Source of truth:
- docs/INVESTOR_COLLECTOR_V1.md

Current repository foundation:
- common secret-safe models;
- adapter interface;
- MT5 read-only probe with fake-module testability;
- MT4 startup config renderer;
- one-shot read-only MT4 history exporter source;
- Python unit tests;
- static regression rules forbidding trade APIs.

Not implemented yet:
- Windows service;
- RSA/DPAPI key management;
- Supabase collector control plane / Edge Functions;
- MT5 history normalization;
- production MT4 launcher and cleanup;
- direct-connect frontend.

Never put real broker credentials in tests, fixtures, examples, GitHub Actions or repository files.

Windows baseline:
- Python 3.12 x64;
- MetaTrader5 dependency pinned in pyproject.toml;
- MT5 terminal;
- broker-compatible MT4 terminal directories.

Tests from repository root:

PYTHONPATH=collector/src python -m unittest discover -s collector/tests -v
node scripts/collector-regression.mjs

Linux CI validates platform-independent contracts and fake MT5 behavior. Actual terminal integration must later run on an owned Windows runner/VPS.
