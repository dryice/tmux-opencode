import net from "node:net"
import type { DaemonRequest, DaemonResponse } from "./types"

export function createDaemonClient({ socketPath }: { socketPath: string }) {
  return {
    request(request: DaemonRequest): Promise<DaemonResponse> {
      return new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath)
        let buffer = ""

        socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`))
        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf8")
        })
        socket.on("end", () => {
          try {
            resolve(JSON.parse(buffer) as DaemonResponse)
          } catch (error) {
            reject(error)
          }
        })
        socket.on("error", reject)
      })
    },
  }
}
