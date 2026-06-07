#!/usr/bin/env python3
"""Install or manage the macOS LaunchAgent for scheduled option snapshots."""

from __future__ import annotations

import argparse
import os
import plistlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LABEL = "com.giselle.option-chain-screener.scheduler"
PLIST_PATH = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
LOG_DIR = ROOT / "data/logs"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install, uninstall, or inspect the option snapshot LaunchAgent.")
    parser.add_argument("--uninstall", action="store_true")
    parser.add_argument("--status", action="store_true")
    return parser.parse_args()


def launchctl(*args: str, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["/bin/launchctl", *args], text=True, capture_output=True, check=check)


def service_target() -> str:
    return f"gui/{os.getuid()}/{LABEL}"


def write_plist() -> None:
    PLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    (ROOT / "data/scheduler").mkdir(parents=True, exist_ok=True)
    payload = {
        "Label": LABEL,
        "ProgramArguments": [
            "/bin/zsh",
            "-lc",
            f"cd {str(ROOT)!r} && {sys.executable!r} scripts/run-due-snapshot.py",
        ],
        "WorkingDirectory": str(ROOT),
        "StartInterval": 300,
        "RunAtLoad": True,
        "StandardOutPath": str(LOG_DIR / "scheduler.out.log"),
        "StandardErrorPath": str(LOG_DIR / "scheduler.err.log"),
        "EnvironmentVariables": {
            "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        },
    }
    with PLIST_PATH.open("wb") as handle:
        plistlib.dump(payload, handle)


def unload_existing() -> None:
    launchctl("bootout", f"gui/{os.getuid()}", str(PLIST_PATH))


def install() -> int:
    write_plist()
    unload_existing()
    bootstrap = launchctl("bootstrap", f"gui/{os.getuid()}", str(PLIST_PATH))
    if bootstrap.returncode != 0:
        print(bootstrap.stderr or bootstrap.stdout, file=sys.stderr)
        return bootstrap.returncode
    launchctl("enable", service_target())
    launchctl("kickstart", "-k", service_target())
    print(f"Installed {LABEL}")
    print(f"Plist: {PLIST_PATH}")
    print(f"Logs: {LOG_DIR}")
    return 0


def uninstall() -> int:
    unload_existing()
    if PLIST_PATH.exists():
        PLIST_PATH.unlink()
    print(f"Uninstalled {LABEL}")
    return 0


def status() -> int:
    result = launchctl("print", service_target())
    print(result.stdout or result.stderr)
    return result.returncode


def main() -> int:
    args = parse_args()
    if args.uninstall:
        return uninstall()
    if args.status:
        return status()
    return install()


if __name__ == "__main__":
    sys.exit(main())
