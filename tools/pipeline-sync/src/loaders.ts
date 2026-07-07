import { readFileSync, existsSync } from "node:fs"
import type {
  SeenJobsFile,
  BrowserFindsFile,
  WarmodeLeadsFile,
  ReferralsFile,
  ReferralPaths2HopFile,
  StrongConnectionsFile,
  PipelineActionsFile,
} from "./types.ts"

export interface SourcePaths {
  seenJobs: string
  browserFinds: string
  warmodeLeads: string
  referrals: string
  referralPaths2hop: string
  strongConnections: string
  pipelineActions: string
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch (e) {
    throw new Error(`failed to parse ${path}: ${(e as Error).message}`)
  }
}

export function loadAll(paths: SourcePaths) {
  const seenJobs = readJson<SeenJobsFile>(paths.seenJobs, { seen: {} })
  const browserFinds = readJson<BrowserFindsFile>(paths.browserFinds, { finds: [] })
  const warmodeLeads = readJson<WarmodeLeadsFile>(paths.warmodeLeads, { leads: [] })
  const referrals = readJson<ReferralsFile>(paths.referrals, { companies: [] })
  const referralPaths2hop = readJson<ReferralPaths2HopFile>(paths.referralPaths2hop, {
    paths_by_broker: {},
  })
  const strongConnections = readJson<StrongConnectionsFile>(paths.strongConnections, {
    strong_connections: [],
  })
  const pipelineActions = readJson<PipelineActionsFile>(paths.pipelineActions, { actions: {} })
  return { seenJobs, browserFinds, warmodeLeads, referrals, referralPaths2hop, strongConnections, pipelineActions }
}
