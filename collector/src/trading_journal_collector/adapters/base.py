from __future__ import annotations

from abc import ABC, abstractmethod

from trading_journal_collector.models import CredentialLease, ProbeResult


class BrokerAdapter(ABC):
    """Read-only broker adapter contract. Deliberately has no trade methods."""

    @abstractmethod
    def probe_read_only(self, credential: CredentialLease) -> ProbeResult:
        raise NotImplementedError
