export type PruneSessionRoot = {
  sessionID: string
  processPID: number | null
  tmuxSessionID: string | null
  tmuxWindowID: string | null
  tmuxPaneID: string | null
}

export type PruneInput = {
  isPIDAlive?: (pid: number) => boolean
  isTmuxTargetLive?: (target: string) => boolean
}

export function tmuxTargetKey(root: Pick<PruneSessionRoot, "tmuxSessionID" | "tmuxWindowID" | "tmuxPaneID">): string | undefined {
  if (root.tmuxSessionID === null || root.tmuxWindowID === null || root.tmuxPaneID === null) {
    return undefined
  }

  return `${root.tmuxSessionID}:${root.tmuxWindowID}:${root.tmuxPaneID}`
}

export function shouldPruneRoot(root: PruneSessionRoot, input: PruneInput): boolean {
  if (root.processPID !== null && input.isPIDAlive && !input.isPIDAlive(root.processPID)) {
    return true
  }

  const tmuxKey = tmuxTargetKey(root)
  if (tmuxKey !== undefined && input.isTmuxTargetLive && !input.isTmuxTargetLive(tmuxKey)) {
    return true
  }

  return false
}
