from __future__ import annotations

import os
import sys
from pathlib import Path

from trading_journal_collector.adapters.mt5 import Mt5Adapter
from trading_journal_collector.api import CollectorApi
from trading_journal_collector.identity import CollectorIdentityStore
from trading_journal_collector.models import Platform
from trading_journal_collector.windows_dpapi import WindowsDpapiProtector
from trading_journal_collector.worker import CollectorWorker


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def build_worker() -> CollectorWorker:
    if sys.platform != "win32":
        raise RuntimeError("production collector must run on the owned Windows host")

    identity_dir = Path(required_env("TJ_IDENTITY_DIR"))
    protector = WindowsDpapiProtector()
    identity = CollectorIdentityStore(identity_dir, protector)
    registration = identity.ensure()

    # Registration is intentionally not automated here. The generated public
    # key + token hash must first be enrolled in collector_private.collector_nodes
    # through an operator-controlled provisioning step.
    if not registration.key_id:
        raise RuntimeError("collector identity initialization failed")

    api = CollectorApi(
        supabase_url=required_env("TJ_SUPABASE_URL"),
        publishable_key=required_env("TJ_SUPABASE_PUBLISHABLE_KEY"),
        token_provider=identity.token_text,
    )

    mt5_terminal = os.environ.get("TJ_MT5_TERMINAL_PATH", "").strip() or None
    adapters = {
        Platform.MT5: Mt5Adapter(terminal_path=mt5_terminal),
        # MT4 is added only after the disposable Windows terminal launcher is
        # implemented and runtime-validated. Until then MT4 jobs fail closed.
    }
    return CollectorWorker(
        api=api,
        identity=identity,
        adapters=adapters,
        initial_sync_days=int(os.environ.get("TJ_INITIAL_SYNC_DAYS", "730")),
        overlap_seconds=int(os.environ.get("TJ_SYNC_OVERLAP_SECONDS", "120")),
        batch_size=int(os.environ.get("TJ_INGEST_BATCH_SIZE", "100")),
    )


def main() -> int:
    worker = build_worker()
    worker.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
