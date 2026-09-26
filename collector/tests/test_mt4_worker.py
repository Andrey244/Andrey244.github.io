from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from trading_journal_collector.adapters.mt4 import Mt4Adapter
from trading_journal_collector.errors import HistoryCoverageError
from trading_journal_collector.models import CredentialLease


class FakeProcess:
    def __init__(self):
        self.returncode = None
        self.terminated = False
        self.killed = False

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = 0

    def kill(self):
        self.killed = True
        self.returncode = -9

    def wait(self, timeout=None):
        if self.returncode is None:
            self.returncode = 0
        return self.returncode


class Mt4LauncherTests(unittest.TestCase):
    def test_history_sync_fails_closed_without_all_history_attestation(self):
        adapter = Mt4Adapter(
            golden_terminal_dir=Path("missing"),
            work_root=Path("missing-work"),
        )
        lease = CredentialLease.from_plaintext(
            login="123456", server="Broker-Demo", password="investor"
        )
        with self.assertRaises(HistoryCoverageError):
            adapter.collect_history(
                lease,
                since_ms=1_699_999_000_000,
                until_ms=1_700_001_000_000,
            )

    def test_disposable_slot_exports_and_cleans_secret_config(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden = root / "golden"
            work = root / "work"
            (golden / "MQL4" / "Scripts").mkdir(parents=True)
            (golden / "terminal.exe").write_bytes(b"terminal")
            (golden / "MQL4" / "Scripts" / "TradeJournalExport_MT4.ex4").write_bytes(b"compiled")

            captured = {}
            proc = FakeProcess()

            def launcher(args, cwd):
                captured["args"] = list(args)
                captured["cwd"] = cwd
                config_path = Path(args[1])
                captured["config"] = config_path.read_text(encoding="utf-8")
                files = cwd / "MQL4" / "Files"
                cursor = int((files / "tj_since_ms.txt").read_text(encoding="ascii"))
                captured["cursor"] = cursor
                (files / "tj_export.jsonl").write_text(
                    json.dumps({
                        "source":"MT4","account":"123456","server":"Broker-Demo",
                        "event_id":"77","order_id":"77","event_time_ms":1700000100000,
                        "open_time_ms":1700000000000,"close_time_ms":1700000100000,
                        "symbol":"EURUSD","side":"BUY","entry_type":"ORDER","volume":0.1,
                        "price":1.1,"open_price":1.1,"close_price":1.11,
                        "stop_loss":1.09,"take_profit":1.12,"closed_by_sl":False,
                        "profit":10,"commission":-1,"swap":0,"fee":0,
                        "magic":"7","comment":"","status":"CLOSED"
                    }) + "\n",
                    encoding="utf-8",
                )
                (files / "tj_status.json").write_text(
                    json.dumps({
                        "source":"MT4","connected":True,"trade_allowed":False,
                        "account":"123456","server":"Broker-Demo",
                        "exported":1,"history_total":1,"code":"OK"
                    }),
                    encoding="utf-8",
                )
                return proc

            adapter = Mt4Adapter(
                golden_terminal_dir=golden,
                work_root=work,
                launcher=launcher,
                timeout_seconds=5,
                poll_seconds=0.01,
                history_all_confirmed=True,
            )
            lease = CredentialLease.from_plaintext(
                login="123456", server="Broker-Demo", password="investor-secret"
            )
            events = adapter.collect_history(
                lease,
                since_ms=1_699_999_000_000,
                until_ms=1_700_001_000_000,
            )
            self.assertEqual(len(events),1)
            self.assertEqual(events[0].event_id,"77")
            self.assertEqual(captured["cursor"],1_699_999_000_000)
            self.assertIn("Password=investor-secret",captured["config"])
            self.assertIn("ExpertsTrades=false",captured["config"])
            self.assertIn("Script=TradeJournalExport_MT4",captured["config"])
            self.assertIn("/portable",captured["args"])
            self.assertTrue(proc.terminated)
            self.assertTrue(work.exists())
            self.assertEqual(list(work.iterdir()),[])


if __name__ == "__main__":
    unittest.main()
