#!/usr/bin/env bash
set -euo pipefail

status_dir="${TMUX_OPENCODE_STATUS_DIR:-${TMPDIR:-/tmp}/opencode-status}"
show_subagents="${TMUX_OPENCODE_SHOW_SUBAGENTS:-0}"

STATUS_DIR="$status_dir" SHOW_SUBAGENTS="$show_subagents" python3 <<'PY'
import json
import os
from pathlib import Path

status_dir = Path(os.environ["STATUS_DIR"])
show_subagents = os.environ.get("SHOW_SUBAGENTS") == "1"
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

        kind = payload.get("kind")
        if kind not in {"root", "subagent"}:
            continue
        if kind == "subagent" and not show_subagents:
            continue

        status = payload.get("status")
        title = payload.get("title")
        summary = payload.get("summary")
        project_name = payload.get("projectName", "")
        if not isinstance(status, str) or not isinstance(title, str) or not isinstance(summary, str):
            continue
        if not isinstance(project_name, str):
            continue

        rows.append((updated_at, kind, status, project_name, title))

rows.sort(key=lambda row: row[0], reverse=True)

if not rows:
    print("No active opencode sessions")
else:
    for _, kind, status, project_name, title in rows:
        prefix = "- " if kind == "subagent" else ""
        print(f"{status:<8} {project_name:<16} {prefix}{title}")
PY
