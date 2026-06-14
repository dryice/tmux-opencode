import { spawn } from "node:child_process"
import { mkdir, unlink } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createDaemonClient } from "./daemon/client"
import { daemonBaseDirectory, daemonSocketPath } from "./daemon/paths"
import { DAEMON_PROTOCOL_VERSION, type DaemonRequest, type SessionMutation } from "./daemon/types"

function isSocketAlive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath)
    socket.on("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.on("error", () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function ensureRunning() {
  const sockPath = daemonSocketPath()

  if (await isSocketAlive(sockPath)) {
    return
  }

  await unlink(sockPath).catch(() => {})
  await mkdir(daemonBaseDirectory(), { recursive: true, mode: 0o700 })
  const child = spawn(process.execPath, [fileURLToPath(new URL("./daemon-entry.js", import.meta.url))], {
    detached: true,
    stdio: "ignore",
  })
  child.on("error", () => {})
  child.unref()

  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (await isSocketAlive(sockPath)) {
      return
    }
  }

  throw new Error("daemon did not become reachable after retry loop")
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
  try {
    await ensureRunning()
    const client = createDaemonClient({ socketPath: daemonSocketPath() })
    const response = await client.request(request)
    process.stdout.write(`${JSON.stringify(response)}\n`)
    if (response.type === "error") {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`daemon-cli error: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
