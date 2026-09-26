from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from trading_journal_collector.api import CollectorApi
from trading_journal_collector.errors import WriteCapableCredentialError
from trading_journal_collector.models import CollectorJob, NormalizedEvent, Platform
from trading_journal_collector.worker import CollectorWorker


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def post(self, url, *, headers, body, timeout):
        self.calls.append((url, headers, json.loads(body.decode("utf-8")), timeout))
        return self.responses.pop(0)


class ApiTests(unittest.TestCase):
    def test_collector_api_uses_publishable_key_and_collector_token_only(self):
        transport = FakeTransport([(200, b'{"job":null}')])
        api = CollectorApi(
            supabase_url="https://example.supabase.co",
            publishable_key="public-key-" + "x" * 32,
            token_provider=lambda: "tjc_" + "a" * 64,
            transport=transport,
        )
        self.assertIsNone(api.next_job())
        _, headers, _, _ = transport.calls[0]
        self.assertIn("apikey", headers)
        self.assertIn("x-collector-token", headers)
        self.assertNotIn("Authorization", headers)
        self.assertNotIn("service_role", json.dumps(headers).lower())

    def test_collector_api_sends_attempt_and_exact_sync_cursor(self):
        transport = FakeTransport([(200, b'{"inserted":1}'), (200, b'{"accepted":true}')])
        api = CollectorApi(
            supabase_url="https://example.supabase.co",
            publishable_key="public-key-" + "x" * 32,
            token_provider=lambda: "tjc_" + "a" * 64,
            transport=transport,
        )
        api.ingest_events("11111111-1111-4111-8111-111111111111", 3, [{"event_id":"1"}])
        api.report_job(
            "11111111-1111-4111-8111-111111111111",
            3,
            success=True,
            sync_until_ms=2_000_000,
        )
        self.assertEqual(transport.calls[0][2]["attempt"], 3)
        self.assertEqual(transport.calls[1][2]["attempt"], 3)
        self.assertEqual(transport.calls[1][2]["sync_until_ms"], 2_000_000)


class FakeKeyStore:
    def __init__(self):
        self.decrypt_calls = 0

    def decrypt(self, ciphertext):
        self.decrypt_calls += 1
        self.last_ciphertext = ciphertext
        return bytearray(b"investor")


class FakeIdentity:
    def __init__(self, key_id="key-1"):
        self.key_store = FakeKeyStore()
        self.key_id = key_id

    def ensure(self):
        return SimpleNamespace(key_id=self.key_id)


class FakeApi:
    def __init__(self, job):
        self.job = job
        self.ingested = []
        self.reports = []

    def next_job(self):
        job, self.job = self.job, None
        return job

    def ingest_events(self, job_id, attempt, events):
        self.ingested.append((job_id, attempt, list(events)))
        return len(events)

    def report_job(self, job_id, attempt, *, success, error_code=None, sync_until_ms=None):
        self.reports.append((job_id, attempt, success, error_code, sync_until_ms))


class FakeHistoryAdapter:
    def __init__(self, *, error=None):
        self.error = error
        self.probes = 0
        self.history_calls = []

    def probe_read_only(self, credential):
        self.probes += 1
        if self.error:
            raise self.error

    def collect_history(self, credential, *, since_ms, until_ms):
        self.history_calls.append((since_ms, until_ms, credential.password_text()))
        if self.error:
            raise self.error
        return [
            NormalizedEvent(
                source=Platform.MT5,
                account=credential.login,
                server=credential.server,
                event_id="1",
                payload={
                    "source":"MT5","account":credential.login,"server":credential.server,
                    "event_id":"1","event_time_ms":until_ms,"symbol":"EURUSD",
                    "side":"BUY","entry_type":"IN","volume":0.1,"price":1.1,
                    "profit":0,"commission":0,"swap":0,"fee":0
                },
            )
        ]


def job(**overrides):
    base = {
        "job_id":"11111111-1111-4111-8111-111111111111",
        "connection_id":"22222222-2222-4222-8222-222222222222",
        "job_type":"SYNC",
        "platform":"MT5",
        "login":"123456",
        "server":"Broker-Demo",
        "key_id":"key-1",
        "ciphertext_base64":"AA==" * 0,
        "attempt":1,
        "lease_until":None,
        "last_sync_at":"1970-01-01T00:20:00+00:00",
    }
    base.update(overrides)
    # RSA-3072 ciphertext is 384 bytes => 512 base64 chars.
    import base64
    base["ciphertext_base64"] = base.get("ciphertext_base64") or base64.b64encode(b"x"*384).decode()
    return CollectorJob.from_payload(base)


class WorkerTests(unittest.TestCase):
    def test_sync_uses_overlap_cursor_and_reports_success(self):
        adapter = FakeHistoryAdapter()
        api = FakeApi(job())
        worker = CollectorWorker(
            api=api,
            identity=FakeIdentity(),
            adapters={Platform.MT5:adapter},
            now_ms=lambda:2_000_000,
            overlap_seconds=120,
            batch_size=100,
        )
        self.assertTrue(worker.run_once())
        self.assertEqual(adapter.history_calls[0][0], 1_080_000)
        self.assertEqual(adapter.history_calls[0][1], 2_000_000)
        self.assertEqual(len(api.ingested),1)
        self.assertEqual(api.ingested[0][0], job().job_id)
        self.assertEqual(api.ingested[0][1], job().attempt)
        self.assertEqual(len(api.ingested[0][2]), 1)
        self.assertEqual(
            api.reports,
            [(job().job_id, job().attempt, True, None, 2_000_000)],
        )

    def test_initial_sync_uses_configured_window(self):
        adapter = FakeHistoryAdapter()
        api = FakeApi(job(last_sync_at=None))
        worker = CollectorWorker(
            api=api,
            identity=FakeIdentity(),
            adapters={Platform.MT5:adapter},
            now_ms=lambda:1_000_000_000,
            initial_sync_days=1,
        )
        worker.run_once()
        self.assertEqual(adapter.history_calls[0][0], max(0,1_000_000_000-86_400_000))

    def test_write_capable_credential_reports_safe_code(self):
        adapter = FakeHistoryAdapter(error=WriteCapableCredentialError("must never leak broker details"))
        api = FakeApi(job(job_type="VALIDATE"))
        worker = CollectorWorker(
            api=api,
            identity=FakeIdentity(),
            adapters={Platform.MT5:adapter},
        )
        worker.run_once()
        self.assertEqual(
            api.reports[0][1:],
            (job(job_type="VALIDATE").attempt, False, "WRITE_CAPABLE_CREDENTIAL", None),
        )

    def test_key_mismatch_fails_before_decrypt(self):
        identity = FakeIdentity(key_id="local-key")
        api = FakeApi(job(key_id="other-key"))
        worker = CollectorWorker(
            api=api,
            identity=identity,
            adapters={Platform.MT5:FakeHistoryAdapter()},
        )
        worker.run_once()
        self.assertEqual(identity.key_store.decrypt_calls,0)
        self.assertEqual(
            api.reports[0][1:],
            (job(key_id="other-key").attempt, False, "INVALID_JOB_PAYLOAD", None),
        )


if __name__ == "__main__":
    unittest.main()
