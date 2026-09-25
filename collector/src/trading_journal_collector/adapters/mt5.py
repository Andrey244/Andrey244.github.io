from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from trading_journal_collector.adapters.base import BrokerAdapter
from trading_journal_collector.errors import (
    AccountMismatchError,
    AdapterUnavailableError,
    ConnectionProbeError,
    WriteCapableCredentialError,
)
from trading_journal_collector.models import (
    CredentialLease,
    NormalizedEvent,
    Platform,
    ProbeResult,
)


class Mt5Adapter(BrokerAdapter):
    """Read-only MT5 adapter.

    It only initializes/logs into the terminal, reads account metadata and
    history deals, then shuts the terminal down. There are deliberately no
    order placement/modification methods.
    """

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

    @contextmanager
    def _session(self, credential: CredentialLease) -> Iterator[Any]:
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

            if bool(getattr(account, "trade_allowed", True)):
                raise WriteCapableCredentialError(
                    "MT5 reports trade_allowed=true; use the Investor Password"
                )
            yield mt5
        finally:
            password = ""
            if initialized:
                try:
                    mt5.shutdown()
                except Exception:
                    pass

    def probe_read_only(self, credential: CredentialLease) -> ProbeResult:
        with self._session(credential):
            return ProbeResult(
                platform=Platform.MT5,
                login=credential.login,
                server=credential.server,
                connected=True,
                trade_allowed=False,
                read_only_restricted=True,
                restriction_reason="ACCOUNT_TRADE_ALLOWED=false",
            )

    def collect_history(
        self,
        credential: CredentialLease,
        *,
        since_ms: int,
        until_ms: int,
    ) -> list[NormalizedEvent]:
        if since_ms < 0 or until_ms <= since_ms:
            raise ValueError("invalid MT5 history interval")

        with self._session(credential) as mt5:
            # MetaQuotes documents numeric interval arguments as seconds since
            # 1970-01-01. Passing integers avoids host-local datetime ambiguity.
            deals = mt5.history_deals_get(
                int(since_ms // 1000),
                int(until_ms // 1000) + 1,
            )
            if deals is None:
                raise ConnectionProbeError(f"MT5 history_deals_get failed: {mt5.last_error()}")

            out: list[NormalizedEvent] = []
            for deal in deals:
                event = self._normalize_deal(mt5, credential, deal)
                if event is not None:
                    out.append(event)
            out.sort(key=lambda e: int(e.payload.get("event_time_ms", 0)))
            return out

    @staticmethod
    def _normalize_deal(
        mt5: Any,
        credential: CredentialLease,
        deal: Any,
    ) -> NormalizedEvent | None:
        deal_type = getattr(deal, "type", None)
        if deal_type == getattr(mt5, "DEAL_TYPE_BUY", object()):
            side = "BUY"
        elif deal_type == getattr(mt5, "DEAL_TYPE_SELL", object()):
            side = "SELL"
        else:
            # Balance, credit, commissions, cancelled deals, dividends, etc.
            # are intentionally not emitted by the first MT5 direct adapter.
            return None

        ticket = int(getattr(deal, "ticket", 0) or 0)
        symbol = str(getattr(deal, "symbol", "") or "").strip()
        volume = float(getattr(deal, "volume", 0.0) or 0.0)
        if ticket <= 0 or not symbol or volume <= 0:
            return None

        entry_code = getattr(deal, "entry", None)
        entry_map = {
            getattr(mt5, "DEAL_ENTRY_IN", object()): "IN",
            getattr(mt5, "DEAL_ENTRY_OUT", object()): "OUT",
            getattr(mt5, "DEAL_ENTRY_INOUT", object()): "INOUT",
            getattr(mt5, "DEAL_ENTRY_OUT_BY", object()): "OUT_BY",
        }
        entry_type = entry_map.get(entry_code, "DEAL")

        reason = getattr(deal, "reason", None)
        closed_by_sl = reason == getattr(mt5, "DEAL_REASON_SL", object())
        event_time_ms = int(
            getattr(deal, "time_msc", 0)
            or (int(getattr(deal, "time", 0) or 0) * 1000)
        )
        if event_time_ms <= 0:
            return None

        order = int(getattr(deal, "order", 0) or 0)
        position = int(getattr(deal, "position_id", 0) or 0)
        payload = {
            "source": Platform.MT5.value,
            "account": credential.login,
            "server": credential.server,
            "event_id": str(ticket),
            "order_id": str(order) if order > 0 else None,
            "position_id": str(position) if position > 0 else None,
            "event_time_ms": event_time_ms,
            "symbol": symbol,
            "side": side,
            "entry_type": entry_type,
            "volume": volume,
            "price": float(getattr(deal, "price", 0.0) or 0.0),
            "profit": float(getattr(deal, "profit", 0.0) or 0.0),
            "commission": float(getattr(deal, "commission", 0.0) or 0.0),
            "swap": float(getattr(deal, "swap", 0.0) or 0.0),
            "fee": float(getattr(deal, "fee", 0.0) or 0.0),
            "magic": str(int(getattr(deal, "magic", 0) or 0)),
            "comment": str(getattr(deal, "comment", "") or ""),
            "status": "EXECUTED",
            "closed_by_sl": bool(closed_by_sl),
            "deal_reason": int(reason) if reason is not None else None,
            "deal_entry_code": int(entry_code) if entry_code is not None else None,
            "deal_type_code": int(deal_type) if deal_type is not None else None,
            "external_id": str(getattr(deal, "external_id", "") or ""),
        }
        return NormalizedEvent(
            source=Platform.MT5,
            account=credential.login,
            server=credential.server,
            event_id=str(ticket),
            payload=payload,
        )
