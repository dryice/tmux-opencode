import net from "node:net"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { createStore } from "./store"
import { DAEMON_PROTOCOL_VERSION, type DaemonRequest, type DaemonResponse } from "./types"

function invalidRequest(message: string): DaemonResponse {
  return { type: "error", code: "INVALID_REQUEST", message }
}

async function writeResponse(socket: net.Socket, response: DaemonResponse) {
  await new Promise<void>((resolve) => socket.end(JSON.stringify(response), resolve))
}

export async function startDaemonServer({ socketPath, dbPath }: { socketPath: string; dbPath: string }) {
  await mkdir(path.dirname(socketPath), { recursive: true })
  await rm(socketPath, { force: true })
  const store = await createStore({ dbPath })

  const server = net.createServer((socket) => {
    let buffer = ""
    let handled = false

    async function handleRequest() {
      if (handled || !buffer.includes("\n")) {
        return
      }

      handled = true
      const requestText = buffer.slice(0, buffer.indexOf("\n")).trim()
      let response: DaemonResponse

      try {
        const request = JSON.parse(requestText) as DaemonRequest
        if (request.protocolVersion !== DAEMON_PROTOCOL_VERSION) {
          response = {
            type: "error",
            code: "PROTOCOL_VERSION_MISMATCH",
            message: `Expected protocol ${DAEMON_PROTOCOL_VERSION}`,
          }
        } else if (request.type === "mutate") {
          store.applyMutation(request.mutation)
          response = { type: "ok" }
        } else if (request.type === "prune-and-list") {
          await store.prune({
            isPIDAlive: (pid: number) => {
              try {
                process.kill(pid, 0)
                return true
              } catch {
                return false
              }
            },
          })
          response = { type: "rows", rows: await store.listVisibleRows() }
        } else if (request.type === "ensure-running") {
          response = { type: "ok" }
        } else {
          response = invalidRequest("Unknown daemon request")
        }
      } catch (error) {
        response = invalidRequest(error instanceof Error ? error.message : "Invalid daemon request")
      }

      await writeResponse(socket, response)
    }

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      void handleRequest()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(socketPath, resolve)
  })

  return {
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close(async (error) => {
          store.close()
          await rm(socketPath, { force: true })
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}
