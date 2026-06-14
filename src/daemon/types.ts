import type { SessionKind, SessionStatus } from "../types"

export const DAEMON_PROTOCOL_VERSION = 1 as const

export type SessionMutation = {
  type: "upsert-session"
  sessionID: string
  parentID: string | null
  kind: SessionKind
  title: string
  projectName?: string
  processPID?: number
  tmuxSessionID?: string
  tmuxWindowID?: string
  tmuxPaneID?: string
  status: SessionStatus
  summary: string
  updatedAt: number
} | {
  type: "delete-session-tree"
  sessionID: string
} | {
  type: "delete-session"
  sessionID: string
}

export type VisibleRow = {
  sessionID: string
  kind: SessionKind
  status: SessionStatus
  projectName?: string
  title: string
  tmuxSessionID?: string
  tmuxWindowID?: string
  tmuxPaneID?: string
}

export type DaemonRequest =
  | { type: "mutate"; protocolVersion: number; mutation: SessionMutation }
  | { type: "prune-and-list"; protocolVersion: number }
  | { type: "ensure-running"; protocolVersion: number }

export type DaemonResponse =
  | { type: "ok" }
  | { type: "rows"; rows: VisibleRow[] }
  | { type: "error"; code: "PROTOCOL_VERSION_MISMATCH" | "INVALID_REQUEST" | "UNAVAILABLE"; message: string }
