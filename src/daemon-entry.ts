import { daemonDatabasePath, daemonSocketPath } from "./daemon/paths.js"
import { startDaemonServer } from "./daemon/server.js"

await startDaemonServer({
  socketPath: daemonSocketPath(),
  dbPath: daemonDatabasePath(),
})
