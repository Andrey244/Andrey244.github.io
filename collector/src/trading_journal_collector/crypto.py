from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.serialization import load_der_private_key, load_pem_public_key

RSA_KEY_BITS = 3072
RSA_PUBLIC_EXPONENT = 65537
ALGORITHM = "RSA-OAEP-SHA256"


class SecretProtector(Protocol):
    """OS-backed protection for local collector secrets."""

    def protect(self, plaintext: bytes) -> bytes:
        ...

    def unprotect(self, protected: bytes) -> bytes:
        ...


@dataclass(frozen=True)
class CollectorPublicKey:
    key_id: str
    algorithm: str
    public_key_pem: str


def _oaep() -> padding.OAEP:
    return padding.OAEP(
        mgf=padding.MGF1(algorithm=hashes.SHA256()),
        algorithm=hashes.SHA256(),
        label=None,
    )


def _public_key_id(public_key: rsa.RSAPublicKey) -> str:
    der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    digest = hashlib.sha256(der).hexdigest()
    return f"rsa3072-sha256-{digest[:32]}"


def generate_key_material() -> tuple[bytes, CollectorPublicKey]:
    private_key = rsa.generate_private_key(
        public_exponent=RSA_PUBLIC_EXPONENT,
        key_size=RSA_KEY_BITS,
    )
    private_der = private_key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_key = private_key.public_key()
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")
    return private_der, CollectorPublicKey(
        key_id=_public_key_id(public_key),
        algorithm=ALGORITHM,
        public_key_pem=public_pem,
    )


def encrypt_for_public_key(public_key_pem: str, plaintext: bytes) -> bytes:
    public_key = load_pem_public_key(public_key_pem.encode("ascii"))
    if not isinstance(public_key, rsa.RSAPublicKey):
        raise TypeError("collector public key is not RSA")
    if public_key.key_size != RSA_KEY_BITS:
        raise ValueError(f"collector public key must be RSA-{RSA_KEY_BITS}")
    return public_key.encrypt(plaintext, _oaep())


def decrypt_with_private_der(private_der: bytes, ciphertext: bytes) -> bytearray:
    private_key = load_der_private_key(private_der, password=None)
    if not isinstance(private_key, rsa.RSAPrivateKey):
        raise TypeError("collector private key is not RSA")
    if private_key.key_size != RSA_KEY_BITS:
        raise ValueError(f"collector private key must be RSA-{RSA_KEY_BITS}")
    plaintext = private_key.decrypt(ciphertext, _oaep())
    return bytearray(plaintext)


def _atomic_write(path: Path, data: bytes, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.chmod(tmp, mode)
    except OSError:
        pass
    os.replace(tmp, path)


class CollectorKeyStore:
    """Stores only a DPAPI/OS-protected private key on disk.

    Directory ACL hardening is an installer/service responsibility on Windows.
    """

    PRIVATE_FILE = "collector_private_key.protected"
    PUBLIC_FILE = "collector_public_key.pem"
    KEY_ID_FILE = "collector_key_id.txt"

    def __init__(self, root: Path, protector: SecretProtector) -> None:
        self.root = root
        self.protector = protector

    @property
    def private_path(self) -> Path:
        return self.root / self.PRIVATE_FILE

    @property
    def public_path(self) -> Path:
        return self.root / self.PUBLIC_FILE

    @property
    def key_id_path(self) -> Path:
        return self.root / self.KEY_ID_FILE

    def ensure(self) -> CollectorPublicKey:
        existing = [self.private_path.exists(), self.public_path.exists(), self.key_id_path.exists()]
        if any(existing) and not all(existing):
            raise RuntimeError("collector key store is incomplete; refuse automatic regeneration")
        if all(existing):
            public_pem = self.public_path.read_text(encoding="ascii")
            key_id = self.key_id_path.read_text(encoding="ascii").strip()
            public_key = load_pem_public_key(public_pem.encode("ascii"))
            if not isinstance(public_key, rsa.RSAPublicKey) or public_key.key_size != RSA_KEY_BITS:
                raise RuntimeError("stored collector public key is invalid")
            expected = _public_key_id(public_key)
            if key_id != expected:
                raise RuntimeError("stored collector key_id does not match public key")
            return CollectorPublicKey(key_id=key_id, algorithm=ALGORITHM, public_key_pem=public_pem)

        private_der, public = generate_key_material()
        mutable = bytearray(private_der)
        try:
            protected = self.protector.protect(bytes(mutable))
            _atomic_write(self.private_path, protected, 0o600)
            _atomic_write(self.public_path, public.public_key_pem.encode("ascii"), 0o644)
            _atomic_write(self.key_id_path, (public.key_id + "\n").encode("ascii"), 0o644)
        finally:
            for i in range(len(mutable)):
                mutable[i] = 0
        return public

    def decrypt(self, ciphertext: bytes) -> bytearray:
        if not self.private_path.exists():
            raise RuntimeError("collector private key is not initialized")
        private_der = self.protector.unprotect(self.private_path.read_bytes())
        mutable = bytearray(private_der)
        try:
            return decrypt_with_private_der(bytes(mutable), ciphertext)
        finally:
            for i in range(len(mutable)):
                mutable[i] = 0
