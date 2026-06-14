import { daemonDatabasePath, daemonSocketPath } from "./daemon/paths"
import { startDaemonServer } from "./daemon/server"

await startDaemonServer({
  socketPath: daemonSocketPath(),
  dbPath: daemonDatabasePath(),
})
