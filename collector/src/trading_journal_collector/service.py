from __future__ import annotations

import json
import os
import sys

if sys.platform != "win32":
    raise RuntimeError("Trading Journal Collector service is Windows-only")

import servicemanager
import win32event
import win32service
import win32serviceutil

from trading_journal_collector.errors import ControlPlaneError
from trading_journal_collector.main import build_worker
from trading_journal_collector.provision import registration_payload
from trading_journal_collector.service_config import apply_service_config, default_config_path

SERVICE_NAME = "TradingJournalCollector"
DISPLAY_NAME = "Trading Journal Collector"
DESCRIPTION = "Read-only MT4/MT5 Investor Password collector for Trading Journal."


def _write_registration_bundle(config: dict, worker):
    registration = worker.identity.ensure()
    payload = registration_payload(
        name=str(config["collector_name"]),
        registration=registration,
        make_primary=True,
    )
    state_dir = default_config_path().parent / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    output = state_dir / "registration.json"
    tmp = output.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, output)
    return output


class TradingJournalCollectorService(win32serviceutil.ServiceFramework):
    _svc_name_ = SERVICE_NAME
    _svc_display_name_ = DISPLAY_NAME
    _svc_description_ = DESCRIPTION

    def __init__(self, args):
        super().__init__(args)
        self._stop_event = win32event.CreateEvent(None, 0, 0, None)

    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        win32event.SetEvent(self._stop_event)

    def SvcShutdown(self):
        self.SvcStop()

    def SvcDoRun(self):
        servicemanager.LogInfoMsg(f"{SERVICE_NAME} starting")
        try:
            config = apply_service_config(default_config_path())
            worker = build_worker()
            registration_path = _write_registration_bundle(config, worker)
            servicemanager.LogInfoMsg(
                f"{SERVICE_NAME} registration bundle ready at {registration_path}"
            )

            while win32event.WaitForSingleObject(self._stop_event, 0) == win32event.WAIT_TIMEOUT:
                try:
                    worked = worker.run_once()
                    wait_ms = 0 if worked else 2000
                except ControlPlaneError:
                    # Expected before registration.json is enrolled server-side.
                    # Never log collector tokens or job payloads.
                    wait_ms = 30000
                except Exception as exc:
                    servicemanager.LogErrorMsg(
                        f"{SERVICE_NAME} worker error: {type(exc).__name__}"
                    )
                    wait_ms = 10000

                if wait_ms and win32event.WaitForSingleObject(
                    self._stop_event, wait_ms
                ) != win32event.WAIT_TIMEOUT:
                    break
        finally:
            servicemanager.LogInfoMsg(f"{SERVICE_NAME} stopped")


def command_line() -> int:
    win32serviceutil.HandleCommandLine(TradingJournalCollectorService)
    return 0


if __name__ == "__main__":
    raise SystemExit(command_line())
