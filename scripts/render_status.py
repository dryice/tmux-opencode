import json
import os
import sys
from pathlib import Path

PROJECT_NAME_WIDTH = 35

status_dir = Path(os.environ["STATUS_DIR"])
show_subagents = os.environ.get("SHOW_SUBAGENTS") == "1"
render_mode = os.environ.get("RENDER_MODE", "display")
rows = []
status_glyphs = {
    "working": "●",
    "waiting": "…",
    "question": "?",
    "idle": "○",
    "error": "×",
}


def escape_machine_field(value):
    return value.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def normalize_display_field(value):
    return " ".join(value.replace("\t", " ").replace("\r", " ").replace("\n", " ").split())


def append_row(payload, updated_at=0):
    kind = payload.get("kind")
    if kind not in {"root", "subagent"}:
        return
    if kind == "subagent" and not show_subagents:
        return

    status = payload.get("status")
    title = payload.get("title")
    project_name = payload.get("projectName", "")
    if not isinstance(status, str) or not isinstance(title, str):
        return
    if not isinstance(project_name, str):
        return

    session_id = payload.get("sessionID")
    if not isinstance(session_id, str):
        return

    tmux_session_id = payload.get("tmuxSessionID", "")
    tmux_window_id = payload.get("tmuxWindowID", "")
    tmux_pane_id = payload.get("tmuxPaneID", "")
    if not isinstance(tmux_session_id, str):
        tmux_session_id = ""
    if not isinstance(tmux_window_id, str):
        tmux_window_id = ""
    if not isinstance(tmux_pane_id, str):
        tmux_pane_id = ""

    rows.append((updated_at, session_id, kind, status, project_name, title, tmux_session_id, tmux_window_id, tmux_pane_id))


daemon_json = os.environ.get("DAEMON_JSON", "")
sort_rows = True

if daemon_json:
    try:
        daemon_payload = json.loads(daemon_json)
    except json.JSONDecodeError as error:
        print(f"Invalid daemon row JSON: {error}", file=sys.stderr)
        raise SystemExit(1)

    if not isinstance(daemon_payload, dict):
        print("Invalid daemon row JSON: expected object", file=sys.stderr)
        raise SystemExit(1)

    if daemon_payload.get("type") == "error":
        message = daemon_payload.get("message")
        print(message if isinstance(message, str) else "daemon returned an error", file=sys.stderr)
        raise SystemExit(1)

    daemon_rows = daemon_payload.get("rows")
    if daemon_payload.get("type") != "rows" or not isinstance(daemon_rows, list):
        print("Invalid daemon row JSON: expected rows response", file=sys.stderr)
        raise SystemExit(1)

    sort_rows = False
    for index, payload in enumerate(daemon_rows):
        if isinstance(payload, dict):
            append_row(payload, -index)
elif status_dir.exists():
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
        summary = payload.get("summary")
        if not isinstance(summary, str):
            continue

        append_row(payload, updated_at)

if sort_rows:
    rows.sort(key=lambda row: row[0], reverse=True)

if not rows:
    if render_mode != "machine":
        print("No active opencode sessions")
else:
    if render_mode == "machine":
        for _, session_id, kind, status, project_name, title, tmux_session_id, tmux_window_id, tmux_pane_id in rows:
            print(
                f"{escape_machine_field(session_id)}\t{escape_machine_field(kind)}\t{escape_machine_field(status)}\t{escape_machine_field(project_name)}\t{escape_machine_field(title)}\t{escape_machine_field(tmux_session_id)}\t{escape_machine_field(tmux_window_id)}\t{escape_machine_field(tmux_pane_id)}"
            )
    else:
        for _, _, kind, status, project_name, title, _, _, _ in rows:
            glyph = status_glyphs.get(status, "•")
            status_label = f"{glyph} {status}"
            prefix = "- " if kind == "subagent" else ""
            display_project_name = normalize_display_field(project_name)[:PROJECT_NAME_WIDTH]
            display_title = normalize_display_field(title)
            print(f"{status_label:<12}  {display_project_name:<{PROJECT_NAME_WIDTH}}  {prefix}{display_title}")
