from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Protocol

from trading_journal_collector.errors import ControlPlaneError
from trading_journal_collector.models import CollectorJob


class Transport(Protocol):
    def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        body: bytes,
        timeout: float,
    ) -> tuple[int, bytes]:
        ...


class UrllibTransport:
    def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        body: bytes,
        timeout: float,
    ) -> tuple[int, bytes]:
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return int(response.status), response.read(2_000_000)
        except urllib.error.HTTPError as exc:
            return int(exc.code), exc.read(64_000)
        except urllib.error.URLError as exc:
            raise ControlPlaneError("NETWORK_ERROR") from exc


@dataclass
class CollectorApi:
    supabase_url: str
    publishable_key: str
    token_provider: Callable[[], str]
    transport: Transport = UrllibTransport()
    timeout_seconds: float = 30.0

    def __post_init__(self) -> None:
        self.supabase_url = self.supabase_url.rstrip("/")
        if not self.supabase_url.startswith("https://"):
            raise ValueError("collector control plane requires HTTPS")
        if len(self.publishable_key) < 20:
            raise ValueError("publishable key is required")

    def _post(self, function_name: str, payload: dict) -> dict:
        token = self.token_provider()
        if len(token) < 32:
            raise ControlPlaneError("COLLECTOR_TOKEN_UNAVAILABLE")
        headers = {
            "apikey": self.publishable_key,
            "content-type": "application/json",
            "x-collector-token": token,
            "user-agent": "TradingJournalCollector/0.1",
        }
        status, raw = self.transport.post(
            f"{self.supabase_url}/functions/v1/{function_name}",
            headers=headers,
            body=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            timeout=self.timeout_seconds,
        )
        try:
            parsed = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            parsed = {}
        if status < 200 or status >= 300:
            code = str(parsed.get("error", f"HTTP_{status}"))[:64]
            if not code.replace("_", "").replace("-", "").isalnum():
                code = f"HTTP_{status}"
            raise ControlPlaneError(code, status)
        if not isinstance(parsed, dict):
            raise ControlPlaneError("INVALID_CONTROL_PLANE_RESPONSE", status)
        return parsed

    def next_job(self) -> CollectorJob | None:
        data = self._post("collector-next-job", {})
        raw_job = data.get("job")
        if raw_job is None:
            return None
        if not isinstance(raw_job, dict):
            raise ControlPlaneError("INVALID_JOB_RESPONSE")
        try:
            return CollectorJob.from_payload(raw_job)
        except (TypeError, ValueError) as exc:
            raise ControlPlaneError("INVALID_JOB_RESPONSE") from exc

    def ingest_events(self, job_id: str, attempt: int, events: list[dict]) -> int:
        data = self._post(
            "collector-ingest",
            {"job_id": job_id, "attempt": int(attempt), "events": events},
        )
        return int(data.get("inserted", 0))

    def report_job(
        self,
        job_id: str,
        attempt: int,
        *,
        success: bool,
        error_code: str | None = None,
        sync_until_ms: int | None = None,
    ) -> None:
        payload = {
            "job_id": job_id,
            "attempt": int(attempt),
            "success": bool(success),
            "error_code": error_code[:128] if error_code else None,
            "sync_until_ms": int(sync_until_ms) if sync_until_ms is not None else None,
        }
        self._post("collector-report", payload)
