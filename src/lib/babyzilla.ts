import { homedir } from "node:os"
import { join } from "node:path"

const BABYZILLA_BIN = Bun.which("babyzilla") ?? join(homedir(), ".local/bin/babyzilla")

export interface BabyzillaStats {
  root: string
  sessions: number
  rawTokens: number
  packTokens: number
  savedPct: number
  requests: {
    sessions: number
    requests: number
    before: number
    after: number
    savedPct: number
  }
  library: { projects: number; modules: number }
}

export interface BabyzillaCost {
  promptTokens: number
  outputTokens: number
  cacheReadTokens: number
  costUsd: number
}

let statsCache: { at: number; value: BabyzillaStats | null } | null = null

async function runJson(args: string[], timeoutMs = 6000): Promise<any | null> {
  if (!BABYZILLA_BIN) return null
  let proc: any
  try {
    proc = Bun.spawn([BABYZILLA_BIN, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, BABYZILLA_NO_UPDATE_CHECK: "1" },
    })
  } catch {
    return null
  }
  const timer = setTimeout(() => {
    try {
      proc.kill()
    } catch {
      // ignore
    }
  }, timeoutMs)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  clearTimeout(timer)
  await proc.exited
  if (proc.exitCode !== 0) return null
  try {
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

export async function babyzillaStats(force = false): Promise<BabyzillaStats | null> {
  const now = Date.now()
  if (!force && statsCache && now - statsCache.at < 30_000) return statsCache.value
  const raw = await runJson(["stats", "--json"])
  const value: BabyzillaStats | null = raw
    ? {
        root: String(raw.root ?? ""),
        sessions: Number(raw.sessions ?? 0),
        rawTokens: Number(raw.rawTokens ?? 0),
        packTokens: Number(raw.packTokens ?? 0),
        savedPct: Number(raw.savedPct ?? 0),
        requests: {
          sessions: Number(raw.requests?.sessions ?? 0),
          requests: Number(raw.requests?.requests ?? 0),
          before: Number(raw.requests?.before ?? 0),
          after: Number(raw.requests?.after ?? 0),
          savedPct: Number(raw.requests?.savedPct ?? 0),
        },
        library: {
          projects: Number(raw.library?.projects ?? 0),
          modules: Number(raw.library?.modules ?? 0),
        },
      }
    : null
  statsCache = { at: now, value }
  return value
}

export async function babyzillaCost(sessionID: string | null | undefined): Promise<BabyzillaCost | null> {
  if (!sessionID) return null
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await runJson(["cost", sessionID, "--json"], 5000)
    const row = raw?.sessions?.[0]
    if (row?.usage) {
      return {
        promptTokens: Number(row.promptTokens ?? row.usage.input ?? 0),
        outputTokens: Number(row.usage.output ?? 0),
        cacheReadTokens: Number(row.usage.cacheRead ?? 0),
        costUsd: Number(row.recordedCost ?? row.estimatedCost ?? 0),
      }
    }
    await Bun.sleep(350)
  }
  return null
}
