import { spawn } from "node:child_process"
import { access, mkdir } from "node:fs/promises"
import path from "node:path"
import { createDaemonClient } from "./daemon/client"
import { daemonBaseDirectory, daemonSocketPath } from "./daemon/paths"
import { DAEMON_PROTOCOL_VERSION, type DaemonRequest, type SessionMutation } from "./daemon/types"

async function ensureRunning() {
  try {
    await access(daemonSocketPath())
    return
  } catch {
    await mkdir(daemonBaseDirectory(), { recursive: true })
    spawn(process.execPath, [new URL("./daemon-entry.js", import.meta.url).pathname], {
      detached: true,
      stdio: "ignore",
    }).unref()
  }
}

function requestForCommand(command: string | undefined, payload: string | undefined): DaemonRequest | undefined {
  if (command === "ensure-running") {
    return { type: "ensure-running", protocolVersion: DAEMON_PROTOCOL_VERSION }
  }

  if (command === "prune-and-list") {
    return { type: "prune-and-list", protocolVersion: DAEMON_PROTOCOL_VERSION }
  }

  if (command === "mutate" && payload !== undefined) {
    return {
      type: "mutate",
      protocolVersion: DAEMON_PROTOCOL_VERSION,
      mutation: JSON.parse(payload) as SessionMutation,
    }
  }

  return undefined
}

const command = process.argv[2]
const request = requestForCommand(command, process.argv[3])

if (request === undefined) {
  process.stderr.write(`Usage: ${path.basename(process.argv[1] ?? "daemon-cli")} ensure-running|prune-and-list|mutate [mutation-json]\n`)
  process.exitCode = 2
} else {
  await ensureRunning()
  const client = createDaemonClient({ socketPath: daemonSocketPath() })
  const response = await client.request(request)
  process.stdout.write(`${JSON.stringify(response)}\n`)
}
