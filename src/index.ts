import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"
import { defaultStatusDirectory, STATUS_DIR_ENV_KEY } from "./types"
import type { SessionSnapshot } from "./types"
import { deleteSnapshot, writeSnapshot } from "./status-store"

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

async function writeSnapshotForSession(
  sessionID: string,
  session: SessionInfo,
  status: SessionSnapshot["status"],
  summary: string,
  projectName?: string,
) {
  await writeSnapshot(directory(), {
    version: 1,
    sessionID,
    parentID: session.parentID ?? null,
    kind: session.parentID ? "subagent" : "root",
    title: session.title,
    projectName,
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
) {
  const session = await readSession(client, sessionID)
  if (!session) return null

  await writeSnapshotForSession(sessionID, session, status, summary, projectName)
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

  async function rememberVisibleRootSnapshot(
    sessionID: string,
    status: SessionSnapshot["status"],
    summary: string,
  ) {
    const session = await writeCurrentSnapshot(client, sessionID, status, summary, projectName)
    if (session && isRootSession(session)) {
      visibleRootSessionID = sessionID
    }
  }

  async function showVisibleSession(sessionID: string) {
    if (visibleRootSessionID && visibleRootSessionID !== sessionID) {
      await deleteSnapshot(directory(), visibleRootSessionID)
    }

    const session = await readSession(client, sessionID)
    if (!session) return

    await writeSnapshotForSession(sessionID, session, "idle", "Session is idle", projectName)
    visibleRootSessionID = isRootSession(session) ? sessionID : visibleRootSessionID
  }

  async function removeVisibleSession(sessionID: string) {
    await deleteSnapshot(directory(), sessionID)
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
        await removeVisibleSession(sessionID)
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

        await writeSnapshotForSession(sessionID, session, "idle", "Session is idle", projectName)
        if (isRootSession(session)) {
          visibleRootSessionID = sessionID
        }
        return
      }

      if (!sessionID) {
        return
      }

      if (event.type === "session.deleted") {
        await removeVisibleSession(sessionID)
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

      await removeVisibleSession(input.sessionID)
    },

    async "permission.ask"(input) {
      await rememberVisibleRootSnapshot(input.sessionID, "waiting", `Permission required: ${input.type}`)
    },
  }
}

export default plugin
