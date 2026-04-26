import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"
import { defaultStatusDirectory, STATUS_DIR_ENV_KEY } from "./types"
import type { SessionSnapshot } from "./types"
import { deleteSnapshot, deleteSnapshotTree, readSnapshot as readStoredSnapshot, snapshotExists, writeSnapshot } from "./status-store"
import { buildTmuxWindowName, renameTmuxWindow, resolveTmuxContext, type TmuxContext } from "./tmux"

function directory(): string {
  return process.env[STATUS_DIR_ENV_KEY] ?? defaultStatusDirectory()
}

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

async function writeSnapshotForSession(
  sessionID: string,
  session: SessionInfo,
  status: SessionSnapshot["status"],
  summary: string,
  projectName?: string,
  tmuxContext?: TmuxContext | null,
) {
  if (session.parentID && !await snapshotExists(directory(), session.parentID)) {
    return
  }

  const resolvedTmuxContext = tmuxContext === undefined ? await resolveTmuxContext() : tmuxContext
  await writeSnapshot(directory(), {
    version: 1,
    sessionID,
    parentID: session.parentID ?? null,
    kind: session.parentID ? "subagent" : "root",
    title: session.title,
    projectName,
    ...tmuxFields(resolvedTmuxContext),
    status,
    summary,
    updatedAt: Date.now(),
  })
}

async function writeCurrentSnapshot(
  client: { session: { get: (input: { path: { id: string } }) => Promise<{ data?: { parentID?: string; title: string } | null }> } },
  sessionID: string,
  status: SessionSnapshot["status"],
  summary: string,
  projectName?: string,
  tmuxContext?: TmuxContext | null,
) {
  const session = await readSession(client, sessionID)
  if (!session) return null

  const resolvedTmuxContext = tmuxContext === undefined ? await resolveTmuxContext() : tmuxContext
  await writeSnapshotForSession(sessionID, session, status, summary, projectName, resolvedTmuxContext)
  return session
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

  async function renameRootWindowIfNeeded(session: SessionInfo, tmuxContext?: TmuxContext | null) {
    if (!isRootSession(session) || !projectName || !tmuxContext?.tmuxWindowID) {
      return
    }

    const desiredWindowTitle = buildTmuxWindowName({
      projectName,
      sessionTitle: session.title,
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
      sessionTitle: session.title,
    })
    renamedWindowTitles.set(tmuxContext.tmuxWindowID, desiredWindowTitle)
  }

  async function rememberVisibleRootSnapshot(
    sessionID: string,
    status: SessionSnapshot["status"],
    summary: string,
  ) {
    const resolvedTmuxContext = await resolveTmuxContext()
    const session = await writeCurrentSnapshot(client, sessionID, status, summary, projectName, resolvedTmuxContext)
    if (session && isRootSession(session)) {
      await renameRootWindowIfNeeded(session, resolvedTmuxContext)
      visibleRootSessionID = sessionID
    }
  }

  async function showVisibleSession(sessionID: string) {
    const session = await readSession(client, sessionID)
    if (!session) return

    const resolvedTmuxContext = await resolveTmuxContext()
    await writeSnapshotForSession(sessionID, session, "idle", "Session is idle", projectName, resolvedTmuxContext)
    await renameRootWindowIfNeeded(session, resolvedTmuxContext)

    if (visibleRootSessionID && visibleRootSessionID !== sessionID) {
      await deleteSnapshot(directory(), visibleRootSessionID)
    }

    visibleRootSessionID = isRootSession(session) ? sessionID : visibleRootSessionID
  }

  async function removeVisibleSession(sessionID: string, options?: { cascade?: boolean }) {
    if (options?.cascade) {
      await deleteSnapshotTree(directory(), sessionID)
    } else {
      await deleteSnapshot(directory(), sessionID)
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
        const snapshot = await readStoredSnapshot(directory(), sessionID)
        if (snapshot?.parentID) {
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
          await deleteSnapshot(directory(), visibleRootSessionID)
        }

        const resolvedTmuxContext = await resolveTmuxContext()
        await writeSnapshotForSession(sessionID, session, "idle", "Session is idle", projectName, resolvedTmuxContext)
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
        const snapshot = await readStoredSnapshot(directory(), sessionID)
        if (snapshot?.parentID) {
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
