from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from trading_journal_collector.adapters.mt4 import Mt4StartupConfig, parse_export_jsonl, validate_export_status
from trading_journal_collector.adapters.mt5 import Mt5Adapter
from trading_journal_collector.errors import AccountMismatchError, WriteCapableCredentialError
from trading_journal_collector.models import CredentialLease, Platform


class FakeMt5:
    def __init__(self, *, trade_allowed: bool, connected: bool = True, login: int = 123456, server: str = "Broker-Demo"):
        self.trade_allowed = trade_allowed
        self.connected = connected
        self.login = login
        self.server = server
        self.shutdown_called = False

    def initialize(self, *args, **kwargs):
        return True

    def terminal_info(self):
        return SimpleNamespace(connected=self.connected)

    def account_info(self):
        return SimpleNamespace(login=self.login, server=self.server, trade_allowed=self.trade_allowed)

    def last_error(self):
        return (0, "OK")

    def shutdown(self):
        self.shutdown_called = True


class CredentialTests(unittest.TestCase):
    def test_repr_redacts_secret_and_clear_overwrites_buffer(self):
        lease = CredentialLease.from_plaintext(login="123456", server="Broker-Demo", password="secret-value")
        self.assertNotIn("secret-value", repr(lease))
        self.assertEqual(lease.password_text(), "secret-value")
        lease.clear()
        self.assertEqual(set(lease.password_bytes), {0})


class Mt5ProbeTests(unittest.TestCase):
    def test_rejects_write_capable_account(self):
        fake = FakeMt5(trade_allowed=True)
        lease = CredentialLease.from_plaintext(login="123456", server="Broker-Demo", password="investor")
        with self.assertRaises(WriteCapableCredentialError):
            Mt5Adapter(mt5_module=fake).probe_read_only(lease)
        self.assertTrue(fake.shutdown_called)

    def test_accepts_connected_trade_restricted_account(self):
        fake = FakeMt5(trade_allowed=False)
        lease = CredentialLease.from_plaintext(login="123456", server="Broker-Demo", password="investor")
        result = Mt5Adapter(mt5_module=fake).probe_read_only(lease)
        self.assertEqual(result.platform, Platform.MT5)
        self.assertTrue(result.connected)
        self.assertFalse(result.trade_allowed)
        self.assertTrue(result.read_only_restricted)
        self.assertTrue(fake.shutdown_called)

    def test_rejects_server_mismatch(self):
        fake = FakeMt5(trade_allowed=False, server="Other-Server")
        lease = CredentialLease.from_plaintext(login="123456", server="Broker-Demo", password="investor")
        with self.assertRaises(AccountMismatchError):
            Mt5Adapter(mt5_module=fake).probe_read_only(lease)


class Mt4ContractTests(unittest.TestCase):
    def test_startup_config_disables_trade_and_dll_paths(self):
        lease = CredentialLease.from_plaintext(login="123456", server="Broker-Demo", password="investor")
        config = Mt4StartupConfig().render(lease)
        self.assertIn("ExpertsTrades=false", config)
        self.assertIn("ExpertsDllImport=false", config)
        self.assertIn("ExpertsExpImport=false", config)
        self.assertIn("Script=TradeJournalExport_MT4", config)
        self.assertIn("Login=123456", config)
        self.assertIn("Server=Broker-Demo", config)

    def test_status_rejects_write_capable_mt4(self):
        with self.assertRaises(WriteCapableCredentialError):
            validate_export_status({
                "connected": True,
                "trade_allowed": True,
                "account": "123456",
                "server": "Broker-Demo",
            })

    def test_jsonl_parser_requires_mt4_source(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "events.jsonl"
            p.write_text(json.dumps({
                "source": "MT4",
                "account": "123456",
                "server": "Broker-Demo",
                "event_id": "1",
            }) + "\n", encoding="utf-8")
            rows = list(parse_export_jsonl(p))
            self.assertEqual(rows[0]["source"], "MT4")


if __name__ == "__main__":
    unittest.main()
