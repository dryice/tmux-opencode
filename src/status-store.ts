import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { STALE_AFTER_MS } from "./types"
import type { SessionSnapshot } from "./types"

export async function writeSnapshot(directory: string, snapshot: SessionSnapshot): Promise<void> {
  await mkdir(directory, { recursive: true })
  const target = path.join(directory, `${snapshot.sessionID}.json`)
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
  await rename(temporary, target)
}

export async function deleteSnapshot(directory: string, sessionID: string): Promise<void> {
  await rm(path.join(directory, `${sessionID}.json`), { force: true })
}

export async function listSnapshots(directory: string): Promise<SessionSnapshot[]> {
  await mkdir(directory, { recursive: true })
  const names = await readdir(directory)
  const jsonFiles = names.filter((name) => name.endsWith(".json"))
  const parsed = await Promise.all(
    jsonFiles.map(async (name) => {
      try {
        const content = await readFile(path.join(directory, name), "utf8")
        return JSON.parse(content) as SessionSnapshot
      } catch {
        return null
      }
    }),
  )
  const now = Date.now()
  return parsed.filter((snapshot): snapshot is SessionSnapshot => snapshot !== null && now - snapshot.updatedAt <= STALE_AFTER_MS)
}
