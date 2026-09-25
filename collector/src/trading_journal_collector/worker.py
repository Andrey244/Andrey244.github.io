from __future__ import annotations

import base64
import binascii
import time
from datetime import datetime, timezone
from typing import Callable, Mapping

from trading_journal_collector.api import CollectorApi
from trading_journal_collector.errors import (
    AccountMismatchError,
    AdapterUnavailableError,
    ConnectionProbeError,
    ControlPlaneError,
    WriteCapableCredentialError,
)
from trading_journal_collector.identity import CollectorIdentityStore
from trading_journal_collector.models import (
    CollectorJob,
    CredentialLease,
    NormalizedEvent,
    Platform,
)

DEFAULT_INITIAL_SYNC_DAYS = 730
DEFAULT_OVERLAP_SECONDS = 120
DEFAULT_BATCH_SIZE = 100


def safe_error_code(exc: Exception) -> str:
    if isinstance(exc, WriteCapableCredentialError):
        return "WRITE_CAPABLE_CREDENTIAL"
    if isinstance(exc, AccountMismatchError):
        return "ACCOUNT_MISMATCH"
    if isinstance(exc, AdapterUnavailableError):
        return "ADAPTER_UNAVAILABLE"
    if isinstance(exc, ConnectionProbeError):
        return "BROKER_CONNECTION_FAILED"
    if isinstance(exc, ControlPlaneError):
        return "CONTROL_PLANE_ERROR"
    if isinstance(exc, (ValueError, binascii.Error)):
        return "INVALID_JOB_PAYLOAD"
    return "WORKER_ERROR"


class CollectorWorker:
    def __init__(
        self,
        *,
        api: CollectorApi,
        identity: CollectorIdentityStore,
        adapters: Mapping[Platform, object],
        initial_sync_days: int = DEFAULT_INITIAL_SYNC_DAYS,
        overlap_seconds: int = DEFAULT_OVERLAP_SECONDS,
        batch_size: int = DEFAULT_BATCH_SIZE,
        now_ms: Callable[[], int] | None = None,
    ) -> None:
        if initial_sync_days < 1:
            raise ValueError("initial_sync_days must be positive")
        if overlap_seconds < 0:
            raise ValueError("overlap_seconds must not be negative")
        if batch_size < 1 or batch_size > 200:
            raise ValueError("batch_size must be between 1 and 200")
        self.api = api
        self.identity = identity
        self.adapters = dict(adapters)
        self.initial_sync_days = initial_sync_days
        self.overlap_seconds = overlap_seconds
        self.batch_size = batch_size
        self._now_ms = now_ms or (lambda: int(time.time() * 1000))

    def run_once(self) -> bool:
        job = self.api.next_job()
        if job is None:
            return False

        credential: CredentialLease | None = None
        plaintext: bytearray | None = None
        try:
            registration = self.identity.ensure()
            if job.key_id != registration.key_id:
                raise ValueError("job key does not match local collector key")

            try:
                ciphertext = base64.b64decode(job.ciphertext_base64, validate=True)
            except (ValueError, binascii.Error) as exc:
                raise ValueError("invalid job ciphertext") from exc
            if len(ciphertext) != 384:
                raise ValueError("invalid RSA-3072 ciphertext length")

            plaintext = self.identity.key_store.decrypt(ciphertext)
            credential = CredentialLease.from_bytes(
                login=job.login,
                server=job.server,
                password=plaintext,
            )
            self._clear(plaintext)
            plaintext = None

            adapter = self.adapters.get(job.platform)
            if adapter is None:
                raise AdapterUnavailableError(f"{job.platform.value} adapter is not installed")

            if job.job_type == "VALIDATE":
                probe = getattr(adapter, "probe_read_only", None)
                if not callable(probe):
                    raise AdapterUnavailableError("adapter does not support validation")
                probe(credential)
            elif job.job_type == "SYNC":
                collect = getattr(adapter, "collect_history", None)
                if not callable(collect):
                    raise AdapterUnavailableError("adapter does not support history sync")
                until_ms = self._now_ms()
                since_ms = self._history_start_ms(job, until_ms)
                events = collect(
                    credential,
                    since_ms=since_ms,
                    until_ms=until_ms,
                )
                payloads = [
                    e.to_ingest_payload() if isinstance(e, NormalizedEvent) else dict(e)
                    for e in events
                ]
                for start in range(0, len(payloads), self.batch_size):
                    self.api.ingest_events(
                        job.job_id,
                        payloads[start : start + self.batch_size],
                    )
            else:
                raise ValueError("unsupported job type")

            self.api.report_job(job.job_id, success=True)
        except Exception as exc:
            try:
                self.api.report_job(
                    job.job_id,
                    success=False,
                    error_code=safe_error_code(exc),
                )
            except Exception:
                # The job lease will expire and be retried server-side.
                pass
        finally:
            if plaintext is not None:
                self._clear(plaintext)
            if credential is not None:
                credential.clear()
        return True

    def run_forever(self, *, idle_seconds: float = 2.0) -> None:
        if idle_seconds < 0.1:
            raise ValueError("idle_seconds is too small")
        while True:
            worked = self.run_once()
            if not worked:
                time.sleep(idle_seconds)

    def _history_start_ms(self, job: CollectorJob, until_ms: int) -> int:
        if job.last_sync_at:
            text = job.last_sync_at.strip()
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            dt = datetime.fromisoformat(text)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            cursor_ms = int(dt.timestamp() * 1000)
            return max(0, cursor_ms - self.overlap_seconds * 1000)
        return max(
            0,
            until_ms - self.initial_sync_days * 86_400_000,
        )

    @staticmethod
    def _clear(value: bytearray) -> None:
        for i in range(len(value)):
            value[i] = 0
