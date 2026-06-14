import { DatabaseSync } from "node:sqlite"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { shouldPruneRoot, type PruneInput, type PruneSessionRoot } from "./prune"
import type { SessionMutation, VisibleRow } from "./types"

type SessionRecord = {
  sessionID: string
  kind: VisibleRow["kind"]
  status: VisibleRow["status"]
  projectName: string | null
  title: string
  tmuxSessionID: string | null
  tmuxWindowID: string | null
  tmuxPaneID: string | null
}

type ChildRecord = {
  sessionID: string
}

type UpsertSessionMutation = Extract<SessionMutation, { type: "upsert-session" }>

function rowToVisibleRow(row: SessionRecord): VisibleRow {
  return {
    sessionID: row.sessionID,
    kind: row.kind,
    status: row.status,
    ...(row.projectName === null ? {} : { projectName: row.projectName }),
    title: row.title,
    ...(row.tmuxSessionID === null ? {} : { tmuxSessionID: row.tmuxSessionID }),
    ...(row.tmuxWindowID === null ? {} : { tmuxWindowID: row.tmuxWindowID }),
    ...(row.tmuxPaneID === null ? {} : { tmuxPaneID: row.tmuxPaneID }),
  }
}

function upsertParameters(mutation: UpsertSessionMutation) {
  return {
    sessionID: mutation.sessionID,
    parentID: mutation.parentID,
    kind: mutation.kind,
    title: mutation.title,
    projectName: mutation.projectName ?? null,
    processPID: mutation.processPID ?? null,
    tmuxSessionID: mutation.tmuxSessionID ?? null,
    tmuxWindowID: mutation.tmuxWindowID ?? null,
    tmuxPaneID: mutation.tmuxPaneID ?? null,
    status: mutation.status,
    summary: mutation.summary,
    updatedAt: mutation.updatedAt,
  }
}

export async function createStore({ dbPath }: { dbPath: string }) {
  await mkdir(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      parent_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      project_name TEXT,
      process_pid INTEGER,
      tmux_session_id TEXT,
      tmux_window_id TEXT,
      tmux_pane_id TEXT,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_parent_id_idx ON sessions(parent_id);
    CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions(updated_at DESC);
  `)

  const upsert = db.prepare(`
    INSERT INTO sessions (
      session_id, parent_id, kind, title, project_name, process_pid,
      tmux_session_id, tmux_window_id, tmux_pane_id, status, summary, updated_at
    ) VALUES (
      $sessionID, $parentID, $kind, $title, $projectName, $processPID,
      $tmuxSessionID, $tmuxWindowID, $tmuxPaneID, $status, $summary, $updatedAt
    )
    ON CONFLICT(session_id) DO UPDATE SET
      parent_id = excluded.parent_id,
      kind = excluded.kind,
      title = excluded.title,
      project_name = excluded.project_name,
      process_pid = excluded.process_pid,
      tmux_session_id = excluded.tmux_session_id,
      tmux_window_id = excluded.tmux_window_id,
      tmux_pane_id = excluded.tmux_pane_id,
      status = excluded.status,
      summary = excluded.summary,
      updated_at = excluded.updated_at
  `)

  const deleteSession = db.prepare("DELETE FROM sessions WHERE session_id = ?")
  const listChildren = db.prepare("SELECT session_id as sessionID FROM sessions WHERE parent_id = ?")
  const listVisible = db.prepare(`
    SELECT
      session_id as sessionID,
      kind,
      status,
      project_name as projectName,
      title,
      tmux_session_id as tmuxSessionID,
      tmux_window_id as tmuxWindowID,
      tmux_pane_id as tmuxPaneID
    FROM sessions
    WHERE kind = 'root'
    ORDER BY updated_at DESC
  `)
  const listRoots = db.prepare(`
    SELECT
      session_id as sessionID,
      process_pid as processPID,
      tmux_session_id as tmuxSessionID,
      tmux_window_id as tmuxWindowID,
      tmux_pane_id as tmuxPaneID
    FROM sessions
    WHERE kind = 'root'
  `)

  function deleteSessionTree(sessionID: string) {
    const pending = [sessionID]
    for (const next of pending) {
      const children = listChildren.all(next) as ChildRecord[]
      for (const child of children) {
        pending.push(child.sessionID)
      }
      deleteSession.run(next)
    }
  }

  function applyMutation(mutation: SessionMutation) {
    if (mutation.type === "upsert-session") {
      upsert.run(upsertParameters(mutation))
      return
    }

    if (mutation.type === "delete-session") {
      deleteSession.run(mutation.sessionID)
      return
    }

    deleteSessionTree(mutation.sessionID)
  }

  return {
    applyMutation,
    listVisibleRows(): Promise<VisibleRow[]> {
      const rows = listVisible.all() as SessionRecord[]
      return Promise.resolve(rows.map(rowToVisibleRow))
    },
    prune(input: PruneInput): Promise<void> {
      const roots = listRoots.all() as PruneSessionRoot[]
      for (const root of roots) {
        if (shouldPruneRoot(root, input)) {
          deleteSessionTree(root.sessionID)
        }
      }
      return Promise.resolve()
    },
    close() {
      db.close()
    },
  }
}
