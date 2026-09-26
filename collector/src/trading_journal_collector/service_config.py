from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

CONFIG_ENV_MAP = {
    "supabase_url": "TJ_SUPABASE_URL",
    "supabase_publishable_key": "TJ_SUPABASE_PUBLISHABLE_KEY",
    "identity_dir": "TJ_IDENTITY_DIR",
    "mt5_terminal_path": "TJ_MT5_TERMINAL_PATH",
    "mt4_golden_dir": "TJ_MT4_GOLDEN_DIR",
    "mt4_work_root": "TJ_MT4_WORK_ROOT",
    "mt4_bootstrap_symbol": "TJ_MT4_BOOTSTRAP_SYMBOL",
    "mt4_terminal_exe": "TJ_MT4_TERMINAL_EXE",
    "mt4_timeout_seconds": "TJ_MT4_TIMEOUT_SECONDS",
    "mt4_history_all_confirmed": "TJ_MT4_HISTORY_ALL_CONFIRMED",
    "initial_sync_days": "TJ_INITIAL_SYNC_DAYS",
    "sync_overlap_seconds": "TJ_SYNC_OVERLAP_SECONDS",
    "ingest_batch_size": "TJ_INGEST_BATCH_SIZE",
}
META_KEYS = {"collector_name"}
FORBIDDEN_KEY_PARTS = (
    "password",
    "service_role",
    "secret_key",
    "private_key",
    "collector_token",
    "ingest_token",
)


def default_root() -> Path:
    program_data = os.environ.get("PROGRAMDATA", r"C:\ProgramData")
    return Path(program_data) / "TradingJournalCollector"


def default_config_path() -> Path:
    override = os.environ.get("TJ_CONFIG_PATH", "").strip()
    return Path(override) if override else default_root() / "collector.json"


def load_service_config(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError("collector config must be a JSON object")

    allowed = set(CONFIG_ENV_MAP) | META_KEYS
    for raw_key in data:
        key = str(raw_key).strip()
        low = key.casefold()
        if any(part in low for part in FORBIDDEN_KEY_PARTS):
            raise ValueError(f"secret-like config key is forbidden: {key}")
        if key not in allowed:
            raise ValueError(f"unknown collector config key: {key}")

    for key in ("supabase_url", "supabase_publishable_key", "identity_dir", "collector_name"):
        value = data.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{key} is required")

    if not str(data["supabase_url"]).startswith("https://"):
        raise ValueError("supabase_url must use https")
    if len(str(data["supabase_publishable_key"]).strip()) < 20:
        raise ValueError("supabase_publishable_key is invalid")
    return data


def apply_service_config(path: Path) -> dict[str, Any]:
    data = load_service_config(path)
    for key, env_name in CONFIG_ENV_MAP.items():
        if key not in data or data[key] is None:
            continue
        value = str(data[key]).strip()
        if value:
            os.environ[env_name] = value
        else:
            os.environ.pop(env_name, None)
    return data
