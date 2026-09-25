from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Platform(str, Enum):
    MT4 = "MT4"
    MT5 = "MT5"


@dataclass(frozen=True)
class ConnectionMetadata:
    connection_id: str
    user_id: str
    platform: Platform
    login: str
    server: str
    collector_key_id: str

    def __post_init__(self) -> None:
        for name, value in (
            ("connection_id", self.connection_id),
            ("user_id", self.user_id),
            ("login", self.login),
            ("server", self.server),
            ("collector_key_id", self.collector_key_id),
        ):
            if not value.strip():
                raise ValueError(f"{name} is required")


@dataclass
class CredentialLease:
    """Plaintext broker secret exists only in collector memory during a leased job."""

    login: str
    server: str
    password_bytes: bytearray = field(repr=False)

    @classmethod
    def from_plaintext(cls, *, login: str, server: str, password: str) -> "CredentialLease":
        if not login.strip():
            raise ValueError("login is required")
        if not server.strip():
            raise ValueError("server is required")
        if not password:
            raise ValueError("password is required")
        return cls(
            login=login.strip(),
            server=server.strip(),
            password_bytes=bytearray(password.encode("utf-8")),
        )

    def password_text(self) -> str:
        # Terminal APIs require str, so a short-lived immutable copy is unavoidable.
        return bytes(self.password_bytes).decode("utf-8")

    def clear(self) -> None:
        for i in range(len(self.password_bytes)):
            self.password_bytes[i] = 0

    def __repr__(self) -> str:
        return f"CredentialLease(login={self.login!r}, server={self.server!r}, password=<redacted>)"


@dataclass(frozen=True)
class ProbeResult:
    platform: Platform
    login: str
    server: str
    connected: bool
    trade_allowed: bool
    read_only_restricted: bool
    restriction_reason: str


@dataclass(frozen=True)
class NormalizedEvent:
    source: Platform
    account: str
    server: str
    event_id: str
    payload: dict[str, Any]

    def __post_init__(self) -> None:
        if not self.account.strip():
            raise ValueError("account is required")
        if not self.server.strip():
            raise ValueError("server is required")
        if not self.event_id.strip():
            raise ValueError("event_id is required")
        payload_source = str(self.payload.get("source", self.source.value)).upper()
        if payload_source != self.source.value:
            raise ValueError("payload source does not match event source")

    def to_ingest_payload(self) -> dict[str, Any]:
        out = dict(self.payload)
        out["source"] = self.source.value
        out["account"] = self.account
        out["server"] = self.server
        out["event_id"] = self.event_id
        return out
