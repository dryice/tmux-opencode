import type { Plugin } from "@opencode-ai/plugin"
import { defaultStatusDirectory, STATUS_DIR_ENV_KEY } from "./types"
import type { SessionSnapshot } from "./types"
import { deleteSnapshot, writeSnapshot } from "./status-store"

function directory(): string {
  return process.env[STATUS_DIR_ENV_KEY] ?? defaultStatusDirectory()
}

const plugin: Plugin = async ({ client }) => ({
  async event(input) {
    const event = input.event as {
      type: string
      properties: {
        sessionID: string
        status?: { type: string }
      }
    }
    if (event.type !== "session.status" && event.type !== "question.asked") {
      return
    }

    const sessionID = event.properties.sessionID
    const details = await client.session.get({ path: { id: sessionID } })
    const session = details.data
    if (!session) return

    let status: SessionSnapshot["status"]
    let summary: string

    if (event.type === "question.asked") {
      status = "question"
      summary = "Question asked"
    } else if (event.properties.status?.type === "busy") {
      status = "working"
      summary = `Session is busy`
    } else if (event.properties.status?.type === "idle") {
      status = "idle"
      summary = `Session is idle`
    } else {
      return
    }

    if (status === "idle") {
      await deleteSnapshot(directory(), sessionID)
      return
    }

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
  },

  async "permission.ask"(input) {
    const details = await client.session.get({ path: { id: input.sessionID } })
    const session = details.data
    if (!session) return

    await writeSnapshot(directory(), {
      version: 1,
      sessionID: input.sessionID,
      parentID: session.parentID ?? null,
      kind: session.parentID ? "subagent" : "root",
      title: session.title,
      status: "waiting",
      summary: `Permission required: ${input.type}`,
      updatedAt: Date.now(),
    })
  },
})

export default plugin
