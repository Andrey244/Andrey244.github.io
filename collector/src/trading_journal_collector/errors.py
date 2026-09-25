class CollectorError(RuntimeError):
    """Base collector error."""


class AdapterUnavailableError(CollectorError):
    """Required terminal/module is unavailable."""


class ConnectionProbeError(CollectorError):
    """Broker connection could not be validated."""


class AccountMismatchError(ConnectionProbeError):
    """Connected account differs from requested identity."""


class WriteCapableCredentialError(ConnectionProbeError):
    """Credential appears capable of trading and is rejected."""


class ExportValidationError(CollectorError):
    """MT4 exporter output is invalid or unsafe."""
