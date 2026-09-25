from __future__ import annotations

from typing import Any

from trading_journal_collector.adapters.base import BrokerAdapter
from trading_journal_collector.errors import (
    AccountMismatchError,
    AdapterUnavailableError,
    ConnectionProbeError,
    WriteCapableCredentialError,
)
from trading_journal_collector.models import CredentialLease, Platform, ProbeResult


class Mt5Adapter(BrokerAdapter):
    """Read-only MT5 probe. No order/trade operation is implemented."""

    def __init__(
        self,
        *,
        terminal_path: str | None = None,
        timeout_ms: int = 60_000,
        mt5_module: Any | None = None,
    ) -> None:
        self.terminal_path = terminal_path
        self.timeout_ms = timeout_ms
        self._mt5 = mt5_module

    def _module(self) -> Any:
        if self._mt5 is not None:
            return self._mt5
        try:
            import MetaTrader5 as mt5  # type: ignore
        except ImportError as exc:
            raise AdapterUnavailableError("MetaTrader5 package is not installed") from exc
        self._mt5 = mt5
        return mt5

    def probe_read_only(self, credential: CredentialLease) -> ProbeResult:
        mt5 = self._module()
        password = credential.password_text()
        initialized = False
        try:
            kwargs = {
                "login": int(credential.login),
                "password": password,
                "server": credential.server,
                "timeout": self.timeout_ms,
                "portable": True,
            }
            if self.terminal_path:
                initialized = bool(mt5.initialize(self.terminal_path, **kwargs))
            else:
                initialized = bool(mt5.initialize(**kwargs))

            if not initialized:
                raise ConnectionProbeError(f"MT5 initialize/login failed: {mt5.last_error()}")

            terminal = mt5.terminal_info()
            account = mt5.account_info()
            if terminal is None or account is None:
                raise ConnectionProbeError(f"MT5 account/terminal info unavailable: {mt5.last_error()}")
            if not bool(getattr(terminal, "connected", False)):
                raise ConnectionProbeError("MT5 terminal is not connected to the trade server")

            actual_login = str(getattr(account, "login", ""))
            actual_server = str(getattr(account, "server", ""))
            if actual_login != credential.login:
                raise AccountMismatchError(
                    f"MT5 login mismatch: expected {credential.login}, got {actual_login}"
                )
            if actual_server.casefold() != credential.server.casefold():
                raise AccountMismatchError(
                    f"MT5 server mismatch: expected {credential.server}, got {actual_server}"
                )

            trade_allowed = bool(getattr(account, "trade_allowed", True))
            if trade_allowed:
                raise WriteCapableCredentialError(
                    "MT5 reports trade_allowed=true; use the Investor Password"
                )

            return ProbeResult(
                platform=Platform.MT5,
                login=actual_login,
                server=actual_server,
                connected=True,
                trade_allowed=False,
                read_only_restricted=True,
                restriction_reason="ACCOUNT_TRADE_ALLOWED=false",
            )
        finally:
            password = ""
            if initialized:
                try:
                    mt5.shutdown()
                except Exception:
                    pass
