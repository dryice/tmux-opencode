import json
import os
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

        session_id = payload.get("sessionID")
        if not isinstance(session_id, str):
            continue

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
