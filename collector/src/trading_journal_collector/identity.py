from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from pathlib import Path

from trading_journal_collector.crypto import CollectorKeyStore, CollectorPublicKey, SecretProtector, _atomic_write

TOKEN_PREFIX = "tjc_"
TOKEN_FILE = "collector_auth_token.protected"


def hash_collector_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_collector_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(48)


@dataclass(frozen=True)
class CollectorRegistration:
    key_id: str
    algorithm: str
    public_key_pem: str
    auth_token_hash: str


class CollectorIdentityStore:
    """Local identity material for one owned collector node.

    Plaintext collector token is never written to disk; only its DPAPI/OS
    protected blob is stored locally. The database receives only its SHA-256 hash.
    """

    def __init__(self, root: Path, protector: SecretProtector) -> None:
        self.root = root
        self.protector = protector
        self.key_store = CollectorKeyStore(root, protector)
        self.token_path = root / TOKEN_FILE

    def ensure(self) -> CollectorRegistration:
        public: CollectorPublicKey = self.key_store.ensure()
        if not self.token_path.exists():
            token = generate_collector_token()
            token_bytes = bytearray(token.encode("utf-8"))
            try:
                protected = self.protector.protect(bytes(token_bytes))
                _atomic_write(self.token_path, protected)
            finally:
                for i in range(len(token_bytes)):
                    token_bytes[i] = 0

        token = self.token_text()
        try:
            token_hash = hash_collector_token(token)
        finally:
            token = ""

        return CollectorRegistration(
            key_id=public.key_id,
            algorithm=public.algorithm,
            public_key_pem=public.public_key_pem,
            auth_token_hash=token_hash,
        )

    def token_text(self) -> str:
        if not self.token_path.exists():
            raise RuntimeError("collector token is not initialized")
        raw = self.protector.unprotect(self.token_path.read_bytes())
        return raw.decode("utf-8")

    def rotate_token(self) -> CollectorRegistration:
        token = generate_collector_token()
        token_bytes = bytearray(token.encode("utf-8"))
        try:
            protected = self.protector.protect(bytes(token_bytes))
            _atomic_write(self.token_path, protected)
        finally:
            for i in range(len(token_bytes)):
                token_bytes[i] = 0
        return self.ensure()
