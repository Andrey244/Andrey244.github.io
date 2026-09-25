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
from trading_journal_collector.crypto import CollectorKeyStore, encrypt_for_public_key
from trading_journal_collector.identity import CollectorIdentityStore, hash_collector_token


class FakeMt5:
    def __init__(self, *, trade_allowed: bool, connected: bool = True, login: int = 123456, server: str = "Broker-Demo"):
        self.trade_allowed = trade_allowed
        self.connected = connected
        self.login = login
        self.server = server
        self.shutdown_called = False
        self.deals = []
        self.history_args = None

        self.DEAL_TYPE_BUY = 0
        self.DEAL_TYPE_SELL = 1
        self.DEAL_ENTRY_IN = 0
        self.DEAL_ENTRY_OUT = 1
        self.DEAL_ENTRY_INOUT = 2
        self.DEAL_ENTRY_OUT_BY = 3
        self.DEAL_REASON_CLIENT = 0
        self.DEAL_REASON_SL = 4
        self.DEAL_REASON_TP = 5

    def initialize(self, *args, **kwargs):
        return True

    def terminal_info(self):
        return SimpleNamespace(connected=self.connected)

    def account_info(self):
        return SimpleNamespace(login=self.login, server=self.server, trade_allowed=self.trade_allowed)

    def last_error(self):
        return (0, "OK")

    def history_deals_get(self, start, end):
        self.history_args = (start, end)
        return tuple(self.deals)

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


    def test_history_normalization_preserves_explicit_sl_reason(self):
        fake = FakeMt5(trade_allowed=False)
        fake.deals = [
            SimpleNamespace(
                ticket=101, order=201, time=1_700_000_000, time_msc=1_700_000_000_123,
                type=fake.DEAL_TYPE_BUY, entry=fake.DEAL_ENTRY_IN, magic=7,
                position_id=301, reason=fake.DEAL_REASON_CLIENT, volume=0.1,
                price=1.1000, commission=-0.2, swap=0.0, profit=0.0, fee=0.0,
                symbol="EURUSD", comment="entry", external_id=""
            ),
            SimpleNamespace(
                ticket=102, order=202, time=1_700_000_100, time_msc=1_700_000_100_456,
                type=fake.DEAL_TYPE_SELL, entry=fake.DEAL_ENTRY_OUT, magic=7,
                position_id=301, reason=fake.DEAL_REASON_SL, volume=0.1,
                price=1.0950, commission=-0.2, swap=-0.1, profit=-50.0, fee=0.0,
                symbol="EURUSD", comment="exit", external_id=""
            ),
            SimpleNamespace(
                ticket=103, order=0, time=1_700_000_101, time_msc=1_700_000_101_000,
                type=2, entry=fake.DEAL_ENTRY_IN, magic=0, position_id=0,
                reason=fake.DEAL_REASON_CLIENT, volume=0.0, price=0.0,
                commission=0.0, swap=0.0, profit=100.0, fee=0.0,
                symbol="", comment="balance", external_id=""
            ),
        ]
        lease = CredentialLease.from_plaintext(
            login="123456", server="Broker-Demo", password="investor"
        )
        events = Mt5Adapter(mt5_module=fake).collect_history(
            lease,
            since_ms=1_699_999_000_000,
            until_ms=1_700_001_000_000,
        )
        self.assertEqual(len(events), 2)
        first = events[0].to_ingest_payload()
        second = events[1].to_ingest_payload()
        self.assertEqual(first["side"], "BUY")
        self.assertFalse(first["closed_by_sl"])
        self.assertEqual(second["side"], "SELL")
        self.assertTrue(second["closed_by_sl"])
        self.assertEqual(second["position_id"], "301")
        self.assertEqual(second["entry_type"], "OUT")
        self.assertEqual(second["event_time_ms"], 1_700_000_100_456)
        self.assertTrue(fake.shutdown_called)


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
        self.assertIn("Symbol=EURUSD", config)
        self.assertIn("Period=H1", config)

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


class TestProtector:
    """Reversible test-only wrapper; production uses Windows DPAPI."""

    def protect(self, plaintext: bytes) -> bytes:
        return b"TEST" + bytes(b ^ 0xA5 for b in plaintext)

    def unprotect(self, protected: bytes) -> bytes:
        if not protected.startswith(b"TEST"):
            raise ValueError("invalid protected test blob")
        return bytes(b ^ 0xA5 for b in protected[4:])


class CryptoIdentityTests(unittest.TestCase):
    def test_rsa3072_oaep_round_trip_and_protected_private_storage(self):
        protector = TestProtector()
        with tempfile.TemporaryDirectory() as td:
            store = CollectorKeyStore(Path(td), protector)
            public = store.ensure()
            self.assertTrue(public.key_id.startswith("rsa3072-sha256-"))
            self.assertIn("BEGIN PUBLIC KEY", public.public_key_pem)

            plaintext = b"investor-password-example"
            ciphertext = encrypt_for_public_key(public.public_key_pem, plaintext)
            self.assertEqual(len(ciphertext), 384)
            recovered = store.decrypt(ciphertext)
            try:
                self.assertEqual(bytes(recovered), plaintext)
            finally:
                for i in range(len(recovered)):
                    recovered[i] = 0

            protected = store.private_path.read_bytes()
            self.assertTrue(protected.startswith(b"TEST"))
            self.assertNotIn(b"PRIVATE KEY", protected)

            # Existing key store must be stable across restarts.
            public2 = CollectorKeyStore(Path(td), protector).ensure()
            self.assertEqual(public2.key_id, public.key_id)
            self.assertEqual(public2.public_key_pem, public.public_key_pem)

    def test_collector_token_is_stored_protected_and_db_value_is_hash_only(self):
        protector = TestProtector()
        with tempfile.TemporaryDirectory() as td:
            identity = CollectorIdentityStore(Path(td), protector)
            registration = identity.ensure()
            token = identity.token_text()
            self.assertTrue(token.startswith("tjc_"))
            self.assertEqual(registration.auth_token_hash, hash_collector_token(token))
            self.assertNotEqual(registration.auth_token_hash, token)
            disk = identity.token_path.read_bytes()
            self.assertTrue(disk.startswith(b"TEST"))
            self.assertNotIn(token.encode("utf-8"), disk)

            rotated = identity.rotate_token()
            token2 = identity.token_text()
            self.assertNotEqual(token2, token)
            self.assertEqual(rotated.auth_token_hash, hash_collector_token(token2))


if __name__ == "__main__":
    unittest.main()
