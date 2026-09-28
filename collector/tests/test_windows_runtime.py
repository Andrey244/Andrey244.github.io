from __future__ import annotations

import sys
import unittest
from unittest.mock import patch

from trading_journal_collector.windows_dpapi import WindowsDpapiProtector


@unittest.skipUnless(sys.platform == "win32", "Windows DPAPI integration test")
class WindowsDpapiRuntimeTests(unittest.TestCase):
    def test_current_user_dpapi_round_trip(self):
        protector = WindowsDpapiProtector()
        plaintext = b"TradingJournalCollector-DPAPI-runtime-probe"
        protected = protector.protect(plaintext)
        self.assertIsInstance(protected, bytes)
        self.assertGreater(len(protected), len(plaintext))
        self.assertNotEqual(protected, plaintext)
        self.assertNotIn(plaintext, protected)
        self.assertEqual(protector.unprotect(protected), plaintext)

    def test_entropy_mismatch_fails_closed(self):
        first = WindowsDpapiProtector(entropy=b"TradingJournalCollector:test-a")
        second = WindowsDpapiProtector(entropy=b"TradingJournalCollector:test-b")
        protected = first.protect(b"secret")
        with self.assertRaises(OSError):
            second.unprotect(protected)

    def test_service_registration_uses_explicit_importable_class(self):
        from trading_journal_collector import service

        with patch.object(service.win32serviceutil, "HandleCommandLine") as handle:
            self.assertEqual(service.command_line(), 0)

        handle.assert_called_once_with(
            service.TradingJournalCollectorService,
            serviceClassString=(
                "trading_journal_collector.service."
                "TradingJournalCollectorService"
            ),
        )


if __name__ == "__main__":
    unittest.main()
