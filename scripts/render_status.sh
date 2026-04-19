#!/usr/bin/env bash
set -euo pipefail

status_dir="${TMUX_OPENCODE_STATUS_DIR:-${TMPDIR:-/tmp}/opencode-status}"
show_subagents="${TMUX_OPENCODE_SHOW_SUBAGENTS:-0}"

STATUS_DIR="$status_dir" SHOW_SUBAGENTS="$show_subagents" python3 <<'PY'
import json
import os
import time
from pathlib import Path

status_dir = Path(os.environ["STATUS_DIR"])
show_subagents = os.environ.get("SHOW_SUBAGENTS") == "1"
stale_after_ms = 60_000
now = int(time.time() * 1000)
rows = []

if status_dir.exists():
    for path in sorted(status_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        if not isinstance(payload, dict):
            continue

        updated_at = payload.get("updatedAt")
        if not isinstance(updated_at, int):
            continue
        if now - updated_at > stale_after_ms:
            continue

        kind = payload.get("kind")
        if kind not in {"root", "subagent"}:
            continue
        if kind == "subagent" and not show_subagents:
            continue

        status = payload.get("status")
        title = payload.get("title")
        summary = payload.get("summary")
        if not isinstance(status, str) or not isinstance(title, str) or not isinstance(summary, str):
            continue

        rows.append((updated_at, kind, status, title, summary))

rows.sort(key=lambda row: row[0], reverse=True)

if not rows:
    print("No active opencode sessions")
else:
    for _, kind, status, title, summary in rows:
        prefix = "- " if kind == "subagent" else ""
        print(f"{status:<8} {prefix}{title}  {summary}")
PY
