import type { Plugin } from "@opencode-ai/plugin"
import { defaultStatusDirectory, STATUS_DIR_ENV_KEY } from "./types"
import type { SessionSnapshot } from "./types"
import { deleteSnapshot, writeSnapshot } from "./status-store"

function directory(): string {
  return process.env[STATUS_DIR_ENV_KEY] ?? defaultStatusDirectory()
}

type PluginEvent = {
  type: string
  properties?: {
    sessionID?: string
    info?: {
      id?: string
    }
    status?: { type?: string }
    type?: string
  }
}

function eventSessionID(event: PluginEvent): string | undefined {
  return event.properties?.sessionID ?? event.properties?.info?.id
}

async function readSession(client: { session: { get: (input: { path: { id: string } }) => Promise<{ data?: { parentID?: string; title: string } | null }> } }, sessionID: string) {
  const details = await client.session.get({ path: { id: sessionID } })
  return details.data
}

async function writeCurrentSnapshot(
  client: { session: { get: (input: { path: { id: string } }) => Promise<{ data?: { parentID?: string; title: string } | null }> } },
  sessionID: string,
  status: SessionSnapshot["status"],
  summary: string,
) {
  const session = await readSession(client, sessionID)
  if (!session) return

  await writeSnapshot(directory(), {
    version: 1,
    sessionID,
    parentID: session.parentID ?? null,
    kind: session.parentID ? "subagent" : "root",
    title: session.title,
    status,
    summary,
    updatedAt: Date.now(),
  })
}

const plugin: Plugin = async ({ client }) => {
  return {
    async event(input) {
      const event = input.event as PluginEvent
      const sessionID = eventSessionID(event)
      if (!sessionID) {
        return
      }

      if (event.type === "session.deleted" || event.type === "session.idle") {
        await deleteSnapshot(directory(), sessionID)
        return
      }

      if (event.type === "session.status") {
        if (event.properties?.status?.type === "idle") {
          await deleteSnapshot(directory(), sessionID)
          return
        }

        if (event.properties?.status?.type === "busy" || event.properties?.status?.type === "retry") {
          await writeCurrentSnapshot(client, sessionID, "working", "Session is busy")
        }

        return
      }

      if (event.type === "question.asked") {
        await writeCurrentSnapshot(client, sessionID, "question", "Question asked")
        return
      }

      if (event.type === "permission.asked") {
        await writeCurrentSnapshot(client, sessionID, "waiting", `Permission required: ${event.properties?.type ?? "unknown"}`)
        return
      }
    },

    async "permission.ask"(input) {
      await writeCurrentSnapshot(client, input.sessionID, "waiting", `Permission required: ${input.type}`)
    },
  }
}

export default plugin
