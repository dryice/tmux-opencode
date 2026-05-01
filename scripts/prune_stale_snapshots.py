import json
import os
import subprocess
from collections import deque
from pathlib import Path


TMUX_TIMEOUT_SECONDS = 1


class TmuxTimeoutError(RuntimeError):
    pass


TMUX_MISSING = object()


def sanitized_env_path(name: str) -> str | None:
    value = os.environ.get(name)
    if value is None:
        return None

    value = value.strip()
    return value or None


def fallback_tmpdir() -> Path:
    return Path(sanitized_env_path("TMPDIR") or "/tmp")


def status_directory() -> Path:
    configured = sanitized_env_path("TMUX_OPENCODE_STATUS_DIR")
    if configured:
        return Path(configured)
    return fallback_tmpdir() / "opencode-status"


def valid_snapshot_payload(path: Path, payload) -> str | None:
    if not isinstance(payload, dict):
        return None

    session_id = payload.get("sessionID")
    if not isinstance(session_id, str) or not session_id:
        return None
    if path.name != f"{session_id}.json":
        return None

    if payload.get("version") != 1:
        return None
    if payload.get("kind") not in {"root", "subagent"}:
        return None
    if not isinstance(payload.get("title"), str):
        return None
    if not isinstance(payload.get("status"), str):
        return None
    if not isinstance(payload.get("summary"), str):
        return None
    if isinstance(payload.get("updatedAt"), bool) or not isinstance(payload.get("updatedAt"), int):
        return None

    parent_id = payload.get("parentID")
    if parent_id is not None and not isinstance(parent_id, str):
        return None

    return session_id


def read_snapshots(status_dir: Path):
    snapshots = {}
    paths = {}

    if not status_dir.exists():
        return snapshots, paths

    for path in status_dir.glob("*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        session_id = valid_snapshot_payload(path, payload)
        if session_id is None:
            continue

        snapshots[session_id] = payload
        paths[session_id] = path

    return snapshots, paths


def build_children(snapshots):
    children = {}
    for session_id, payload in snapshots.items():
        parent_id = payload.get("parentID")
        if isinstance(parent_id, str):
            children.setdefault(parent_id, []).append(session_id)
    return children


def delete_snapshot_tree(root_id: str, paths, children) -> None:
    pending = deque([root_id])
    seen = {root_id}

    while pending:
        session_id = pending.popleft()
        path = paths.get(session_id)
        if path is not None:
            try:
                path.unlink()
            except FileNotFoundError:
                pass

        for child_id in children.get(session_id, []):
            if child_id in seen:
                continue
            seen.add(child_id)
            pending.append(child_id)


def pid_is_alive(payload) -> bool:
    pid = payload.get("processPID")
    if isinstance(pid, bool) or not isinstance(pid, int):
        return True
    if pid <= 0:
        return False

    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except ProcessLookupError:
        return False
    except OSError:
        return False


def tmux_output(args):
    try:
        completed = subprocess.run(
            ["tmux", *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            timeout=TMUX_TIMEOUT_SECONDS,
            check=False,
        )
    except FileNotFoundError:
        return TMUX_MISSING
    except subprocess.TimeoutExpired as exc:
        raise TmuxTimeoutError from exc

    if completed.returncode != 0:
        return None
    return completed.stdout.splitlines()


def tmux_metadata_is_alive(payload) -> bool:
    tmux_session_id = payload.get("tmuxSessionID")
    tmux_window_id = payload.get("tmuxWindowID")
    tmux_pane_id = payload.get("tmuxPaneID")

    if not all(isinstance(value, str) and value for value in [tmux_session_id, tmux_window_id, tmux_pane_id]):
        return True

    session_result = tmux_output(["has-session", "-t", tmux_session_id])
    if session_result is TMUX_MISSING:
        return True
    if session_result is None:
        return False

    windows = tmux_output(["list-windows", "-t", tmux_session_id, "-F", "#{window_id}"])
    if windows is TMUX_MISSING:
        return True
    if windows is None or tmux_window_id not in windows:
        return False

    panes = tmux_output(["list-panes", "-t", tmux_window_id, "-F", "#{pane_id}"])
    if panes is TMUX_MISSING:
        return True
    if panes is None or tmux_pane_id not in panes:
        return False

    return True


def main() -> None:
    snapshots, paths = read_snapshots(status_directory())
    children = build_children(snapshots)

    for session_id, payload in snapshots.items():
        if payload.get("kind") != "root":
            continue
        if not pid_is_alive(payload) or not tmux_metadata_is_alive(payload):
            delete_snapshot_tree(session_id, paths, children)


if __name__ == "__main__":
    try:
        main()
    except TmuxTimeoutError:
        raise SystemExit("timed out waiting for tmux")
