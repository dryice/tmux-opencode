import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"
import type { SessionStatus } from "./types"
import { createDaemonClient } from "./daemon/client"
import { daemonSocketPath } from "./daemon/paths"
import { DAEMON_PROTOCOL_VERSION, type SessionMutation } from "./daemon/types"
import { buildTmuxWindowName, renameTmuxWindow, resolveTmuxContext, type TmuxContext } from "./tmux"

type PluginEvent = {
  type: string
  status?: string | { type?: string }
  command?: string
  properties?: {
    sessionID?: string
    info?: {
      id?: string
      parentID?: string
      title?: string
    }
    status?: string | { type?: string }
    type?: string
    command?: string
    name?: string
  }
}

type SessionInfo = {
  parentID?: string
  title: string
}

type ProjectInfo = {
  name?: string
  worktree?: string
}

function eventSessionID(event: PluginEvent): string | undefined {
  return event.properties?.sessionID ?? event.properties?.info?.id
}

function eventStatusType(event: PluginEvent): string | undefined {
  const status = event.properties?.status ?? event.status
  return typeof status === "string" ? status : status?.type
}

async function readSession(client: { session: { get: (input: { path: { id: string } }) => Promise<{ data?: { parentID?: string; title: string } | null }> } }, sessionID: string) {
  const details = await client.session.get({ path: { id: sessionID } })
  return details.data
}

function isRootSession(session: SessionInfo): boolean {
  return !session.parentID
}

function tmuxFields(tmuxContext: TmuxContext | null | undefined) {
  if (!tmuxContext) {
    return {}
  }

  return {
    tmuxSessionID: tmuxContext.tmuxSessionID,
    tmuxWindowID: tmuxContext.tmuxWindowID,
    tmuxPaneID: tmuxContext.tmuxPaneID,
  }
}

export async function sendSessionMutation(mutation: SessionMutation) {
  const client = createDaemonClient({ socketPath: daemonSocketPath() })
  const response = await client.request({ type: "mutate", protocolVersion: DAEMON_PROTOCOL_VERSION, mutation })
  if (response.type === "error") {
    throw new Error(response.message)
  }
}

async function sendSnapshotForSession(
  sessionID: string,
  session: SessionInfo,
  status: SessionStatus,
  summary: string,
  projectName?: string,
  tmuxContext?: TmuxContext | null,
  parentIsVisible: (parentID: string) => boolean = () => true,
) {
  if (session.parentID && !parentIsVisible(session.parentID)) {
    return false
  }

  const resolvedTmuxContext = tmuxContext === undefined ? await resolveTmuxContext() : tmuxContext
  await sendSessionMutation({
    type: "upsert-session",
    sessionID,
    parentID: session.parentID ?? null,
    kind: session.parentID ? "subagent" : "root",
    title: session.title,
    projectName,
    ...(session.parentID ? {} : { processPID: process.pid }),
    ...tmuxFields(resolvedTmuxContext),
    status,
    summary,
    updatedAt: Date.now(),
  })
  return true
}

async function writeCurrentSnapshot(
  client: { session: { get: (input: { path: { id: string } }) => Promise<{ data?: { parentID?: string; title: string } | null }> } },
  sessionID: string,
  status: SessionStatus,
  summary: string,
  projectName?: string,
  tmuxContext?: TmuxContext | null,
  parentIsVisible: (parentID: string) => boolean = () => true,
) {
  const session = await readSession(client, sessionID)
  if (!session) return null

  const resolvedTmuxContext = tmuxContext === undefined ? await resolveTmuxContext() : tmuxContext
  const sent = await sendSnapshotForSession(sessionID, session, status, summary, projectName, resolvedTmuxContext, parentIsVisible)
  return sent ? session : null
}

function deriveProjectName(project: ProjectInfo | undefined): string | undefined {
  const explicitName = project?.name?.trim()
  if (explicitName) {
    return explicitName
  }

  if (!project?.worktree) {
    return undefined
  }

  return path.basename(project.worktree)
}

function normalizeCommand(command: string | undefined): string | undefined {
  return command?.trim().replace(/^\//, "").toLowerCase()
}

function eventCommand(event: PluginEvent): string | undefined {
  return normalizeCommand(event.properties?.command ?? event.command ?? event.properties?.name)
}

function isNewSessionCommand(command: string | undefined): boolean {
  const normalized = normalizeCommand(command)
  return normalized === "new" || normalized === "session.new"
}

function isExitCommand(command: string | undefined): boolean {
  const normalized = normalizeCommand(command)
  return normalized === "exit" || normalized?.endsWith(".exit") === true
}

const plugin: Plugin = async ({ client, project }) => {
  let visibleRootSessionID: string | undefined
  const projectName = deriveProjectName(project)
  const renamedWindowTitles = new Map<string, string>()
  const visibleSessionIDs = new Set<string>()
  const parentBySessionID = new Map<string, string>()
  const childIDsByParentID = new Map<string, Set<string>>()

  function isVisibleSession(sessionID: string): boolean {
    return visibleSessionIDs.has(sessionID)
  }

  function rememberVisibleSession(sessionID: string, session: SessionInfo) {
    visibleSessionIDs.add(sessionID)
    if (!session.parentID) {
      return
    }

    parentBySessionID.set(sessionID, session.parentID)
    const childIDs = childIDsByParentID.get(session.parentID) ?? new Set<string>()
    childIDs.add(sessionID)
    childIDsByParentID.set(session.parentID, childIDs)
  }

  function forgetVisibleSession(sessionID: string) {
    visibleSessionIDs.delete(sessionID)
    const parentID = parentBySessionID.get(sessionID)
    if (parentID) {
      childIDsByParentID.get(parentID)?.delete(sessionID)
      parentBySessionID.delete(sessionID)
    }
  }

  function forgetVisibleSessionTree(sessionID: string) {
    const pending = [sessionID]
    for (const nextSessionID of pending) {
      const childIDs = childIDsByParentID.get(nextSessionID)
      if (childIDs) {
        pending.push(...childIDs)
        childIDsByParentID.delete(nextSessionID)
      }
      forgetVisibleSession(nextSessionID)
    }
  }

  async function renameRootWindowIfNeeded(session: SessionInfo, tmuxContext?: TmuxContext | null) {
    if (!isRootSession(session) || !projectName || !tmuxContext?.tmuxWindowID) {
      return
    }

    const desiredWindowTitle = buildTmuxWindowName({
      projectName,
    })
    if (!desiredWindowTitle) {
      return
    }

    if (renamedWindowTitles.get(tmuxContext.tmuxWindowID) === desiredWindowTitle) {
      return
    }

    await renameTmuxWindow({
      tmuxWindowID: tmuxContext.tmuxWindowID,
      projectName,
    })
    renamedWindowTitles.set(tmuxContext.tmuxWindowID, desiredWindowTitle)
  }

  async function rememberVisibleRootSnapshot(
    sessionID: string,
    status: SessionStatus,
    summary: string,
  ) {
    const resolvedTmuxContext = await resolveTmuxContext()
    const session = await writeCurrentSnapshot(client, sessionID, status, summary, projectName, resolvedTmuxContext, isVisibleSession)
    if (!session) {
      return
    }

    rememberVisibleSession(sessionID, session)
    if (isRootSession(session)) {
      await renameRootWindowIfNeeded(session, resolvedTmuxContext)
      visibleRootSessionID = sessionID
    }
  }

  async function showVisibleSession(sessionID: string) {
    const session = await readSession(client, sessionID)
    if (!session) return

    const resolvedTmuxContext = await resolveTmuxContext()
    const sent = await sendSnapshotForSession(sessionID, session, "idle", "Session is idle", projectName, resolvedTmuxContext, isVisibleSession)
    if (!sent) {
      return
    }

    rememberVisibleSession(sessionID, session)
    await renameRootWindowIfNeeded(session, resolvedTmuxContext)

    if (visibleRootSessionID && visibleRootSessionID !== sessionID && isRootSession(session)) {
      await removeVisibleSession(visibleRootSessionID, { cascade: true })
    }

    visibleRootSessionID = isRootSession(session) ? sessionID : visibleRootSessionID
  }

  async function removeVisibleSession(sessionID: string, options: { cascade?: boolean } = {}) {
    if (options?.cascade) {
      await sendSessionMutation({ type: "delete-session-tree", sessionID })
      forgetVisibleSessionTree(sessionID)
    } else {
      await sendSessionMutation({ type: "delete-session", sessionID })
      forgetVisibleSession(sessionID)
    }

    if (visibleRootSessionID === sessionID) {
      visibleRootSessionID = undefined
    }
  }

  return {
    async event(input) {
      const event = input.event as PluginEvent
      const sessionID = eventSessionID(event)

      if (event.type === "tui.session.select" && sessionID) {
        await showVisibleSession(sessionID)
        return
      }

      if (event.type === "command.executed" && sessionID && isExitCommand(eventCommand(event))) {
        if (parentBySessionID.has(sessionID)) {
          return
        }

        await removeVisibleSession(sessionID, { cascade: true })
        return
      }

      if (event.type === "session.created" && sessionID) {
        const info = event.properties?.info
        if (!info?.title) return

        const session: SessionInfo = {
          title: info.title,
          parentID: info.parentID,
        }

        if (visibleRootSessionID && visibleRootSessionID !== sessionID && isRootSession(session)) {
          await removeVisibleSession(visibleRootSessionID, { cascade: true })
        }

        const resolvedTmuxContext = await resolveTmuxContext()
        const sent = await sendSnapshotForSession(sessionID, session, "idle", "Session is idle", projectName, resolvedTmuxContext, isVisibleSession)
        if (!sent) {
          return
        }

        rememberVisibleSession(sessionID, session)
        await renameRootWindowIfNeeded(session, resolvedTmuxContext)
        if (isRootSession(session)) {
          visibleRootSessionID = sessionID
        }
        return
      }

      if (!sessionID) {
        return
      }

      if (event.type === "session.deleted") {
        if (parentBySessionID.has(sessionID)) {
          return
        }

        await removeVisibleSession(sessionID, { cascade: true })
        return
      }

      if (event.type === "session.idle") {
        await rememberVisibleRootSnapshot(sessionID, "idle", "Session is idle")
        return
      }

      if (event.type === "session.status") {
        const status = eventStatusType(event)

        if (status === "idle") {
          await rememberVisibleRootSnapshot(sessionID, "idle", "Session is idle")
          return
        }

        if (status === "busy" || status === "retry") {
          await rememberVisibleRootSnapshot(sessionID, "working", "Session is busy")
        }

        return
      }

      if (event.type === "question.asked") {
        await rememberVisibleRootSnapshot(sessionID, "question", "Question asked")
        return
      }

      if (event.type === "permission.asked") {
        await rememberVisibleRootSnapshot(sessionID, "waiting", `Permission required: ${event.properties?.type ?? "unknown"}`)
        return
      }
    },

    async "command.execute.before"(input) {
      if (!isNewSessionCommand(input.command)) {
        return
      }

      await removeVisibleSession(input.sessionID, { cascade: true })
    },

    async "permission.ask"(input) {
      await rememberVisibleRootSnapshot(input.sessionID, "waiting", `Permission required: ${input.type}`)
    },
  }
}

export default plugin
