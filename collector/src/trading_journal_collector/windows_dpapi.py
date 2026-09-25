from __future__ import annotations

import ctypes
import sys
from ctypes import wintypes

CRYPTPROTECT_UI_FORBIDDEN = 0x1
DEFAULT_ENTROPY = b"TradingJournalCollector:v1"


class DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


def _blob(data: bytes) -> tuple[DATA_BLOB, object]:
    if not data:
        return DATA_BLOB(0, None), None
    buf = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    return DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte))), buf


class WindowsDpapiProtector:
    """Current-user DPAPI protection for a dedicated collector service account.

    Deliberately does not use CRYPTPROTECT_LOCAL_MACHINE: moving the protected
    blob to another Windows account must not make it decryptable.
    """

    def __init__(self, entropy: bytes = DEFAULT_ENTROPY) -> None:
        if sys.platform != "win32":
            raise OSError("Windows DPAPI is available only on Windows")
        self.entropy = entropy
        self._crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
        self._kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

        self._crypt32.CryptProtectData.argtypes = [
            ctypes.POINTER(DATA_BLOB),
            wintypes.LPCWSTR,
            ctypes.POINTER(DATA_BLOB),
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(DATA_BLOB),
        ]
        self._crypt32.CryptProtectData.restype = wintypes.BOOL

        self._crypt32.CryptUnprotectData.argtypes = [
            ctypes.POINTER(DATA_BLOB),
            ctypes.POINTER(wintypes.LPWSTR),
            ctypes.POINTER(DATA_BLOB),
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(DATA_BLOB),
        ]
        self._crypt32.CryptUnprotectData.restype = wintypes.BOOL
        self._kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        self._kernel32.LocalFree.restype = ctypes.c_void_p

    def _call(self, fn, data: bytes) -> bytes:
        input_blob, input_keepalive = _blob(data)
        entropy_blob, entropy_keepalive = _blob(self.entropy)
        output_blob = DATA_BLOB()
        _ = (input_keepalive, entropy_keepalive)

        ok = fn(
            ctypes.byref(input_blob),
            None,
            ctypes.byref(entropy_blob),
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            ctypes.byref(output_blob),
        )
        if not ok:
            raise ctypes.WinError(ctypes.get_last_error())

        try:
            if not output_blob.pbData or output_blob.cbData == 0:
                return b""
            return ctypes.string_at(output_blob.pbData, output_blob.cbData)
        finally:
            if output_blob.pbData:
                self._kernel32.LocalFree(ctypes.cast(output_blob.pbData, ctypes.c_void_p))

    def protect(self, plaintext: bytes) -> bytes:
        return self._call(self._crypt32.CryptProtectData, plaintext)

    def unprotect(self, protected: bytes) -> bytes:
        return self._call(self._crypt32.CryptUnprotectData, protected)
