from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from trading_journal_collector.service_config import apply_service_config, load_service_config


class ServiceConfigTests(unittest.TestCase):
    def valid(self, root: Path) -> dict:
        return {
            "collector_name": "collector-test",
            "supabase_url": "https://example.supabase.co",
            "supabase_publishable_key": "sb_publishable_" + "x" * 32,
            "identity_dir": str(root / "identity"),
            "mt4_work_root": str(root / "mt4"),
            "initial_sync_days": 730,
        }

    def test_valid_config_maps_only_whitelisted_runtime_values(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "collector.json"
            path.write_text(json.dumps(self.valid(Path(td))), encoding="utf-8")
            with patch.dict(os.environ, {}, clear=False):
                data = apply_service_config(path)
                self.assertEqual(data["collector_name"], "collector-test")
                self.assertEqual(os.environ["TJ_SUPABASE_URL"], "https://example.supabase.co")
                self.assertEqual(os.environ["TJ_INITIAL_SYNC_DAYS"], "730")

    def test_secret_like_config_keys_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for key in ("investor_password", "service_role_key", "collector_token", "private_key"):
                data = self.valid(root)
                data[key] = "must-not-be-accepted"
                path = root / f"{key}.json"
                path.write_text(json.dumps(data), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_service_config(path)

    def test_unknown_config_key_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            data = self.valid(root)
            data["surprise_setting"] = "x"
            path = root / "collector.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_service_config(path)


if __name__ == "__main__":
    unittest.main()
