from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from trading_journal_collector.identity import CollectorIdentityStore, CollectorRegistration
from trading_journal_collector.windows_dpapi import WindowsDpapiProtector


def registration_payload(
    *,
    name: str,
    registration: CollectorRegistration,
    make_primary: bool = True,
) -> dict[str, Any]:
    clean_name = name.strip()
    if not clean_name or len(clean_name) > 120:
        raise ValueError("collector name must be 1..120 characters")
    if not registration.key_id.startswith("rsa3072-sha256-"):
        raise ValueError("unexpected collector key id")
    if len(registration.auth_token_hash) != 64:
        raise ValueError("unexpected collector token hash")
    return {
        "name": clean_name,
        "key_id": registration.key_id,
        "algorithm": registration.algorithm,
        "public_key_pem": registration.public_key_pem,
        "auth_token_hash": registration.auth_token_hash,
        "make_primary": bool(make_primary),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create/read the Windows collector identity and emit a non-secret registration bundle."
    )
    parser.add_argument(
        "--identity-dir",
        default=os.environ.get("TJ_IDENTITY_DIR", ""),
        help="DPAPI-protected collector identity directory (or TJ_IDENTITY_DIR).",
    )
    parser.add_argument(
        "--name",
        default=os.environ.get("TJ_COLLECTOR_NAME", ""),
        help="Collector node display name (or TJ_COLLECTOR_NAME).",
    )
    parser.add_argument(
        "--secondary",
        action="store_true",
        help="Register as non-primary instead of replacing the primary collector.",
    )
    parser.add_argument(
        "--output",
        default="-",
        help="Write registration JSON to this path; '-' writes to stdout.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    if sys.platform != "win32":
        raise RuntimeError("collector provisioning must run under the target Windows service account")

    args = build_parser().parse_args(argv)
    if not args.identity_dir:
        raise RuntimeError("identity directory is required")
    if not args.name:
        raise RuntimeError("collector name is required")

    identity = CollectorIdentityStore(
        Path(args.identity_dir),
        WindowsDpapiProtector(),
    )
    registration = identity.ensure()
    payload = registration_payload(
        name=args.name,
        registration=registration,
        make_primary=not args.secondary,
    )
    serialized = json.dumps(payload, indent=2, sort_keys=True) + "\n"

    if args.output == "-":
        sys.stdout.write(serialized)
    else:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(serialized, encoding="utf-8")

    # The provisioning bundle contains only public-key material and the
    # one-way collector-token hash; plaintext collector credentials stay local.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
