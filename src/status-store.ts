import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { SessionSnapshot } from "./types"

function snapshotPath(directory: string, sessionID: string): string {
  return path.join(directory, `${sessionID}.json`)
}

export async function writeSnapshot(directory: string, snapshot: SessionSnapshot): Promise<void> {
  await mkdir(directory, { recursive: true })
  const target = snapshotPath(directory, snapshot.sessionID)
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
  await rename(temporary, target)
}

export async function deleteSnapshot(directory: string, sessionID: string): Promise<void> {
  await rm(snapshotPath(directory, sessionID), { force: true })
}

export async function snapshotExists(directory: string, sessionID: string): Promise<boolean> {
  try {
    await access(snapshotPath(directory, sessionID))
    return true
  } catch {
    return false
  }
}

export async function readSnapshot(directory: string, sessionID: string): Promise<SessionSnapshot | null> {
  try {
    const content = await readFile(snapshotPath(directory, sessionID), "utf8")
    return JSON.parse(content) as SessionSnapshot
  } catch {
    return null
  }
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
  return parsed.filter((snapshot): snapshot is SessionSnapshot => snapshot !== null)
}

export async function deleteSnapshotTree(directory: string, rootSessionID: string): Promise<void> {
  const snapshots = await listSnapshots(directory)
  const pending = [rootSessionID]
  const toDelete = new Set<string>([rootSessionID])

  while (pending.length > 0) {
    const parentID = pending.shift()
    if (!parentID) {
      continue
    }

    for (const snapshot of snapshots) {
      if (snapshot.parentID !== parentID || toDelete.has(snapshot.sessionID)) {
        continue
      }

      toDelete.add(snapshot.sessionID)
      pending.push(snapshot.sessionID)
    }
  }

  await Promise.all([...toDelete].map((sessionID) => deleteSnapshot(directory, sessionID)))
}
