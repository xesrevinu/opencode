import { existsSync, statSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { readJsonl, walkFiles } from "./jsonl"
import { markLive } from "./live"
import type { SessionSummary } from "./model"

export type ListIOHooks = {
  walk?: (root: string) => void
  openSqlite?: (file: string) => void
}

const sessionLists = new Map<string, { stamp: string; sessions: SessionSummary[] }>()
const walks = new Map<string, { stamp: string; files: string[] }>()
const jsonFiles = new Map<string, { stamp: string; value: unknown }>()
const jsonlFiles = new Map<string, { stamp: string; value: unknown[] }>()

let hooks: ListIOHooks | undefined

export function withListIO<T>(next: ListIOHooks, fn: () => T | Promise<T>): Promise<T> {
  const previous = hooks
  hooks = next
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      hooks = previous
    })
}

export function noteWalk(root: string) {
  hooks?.walk?.(root)
}

export function noteOpenSqlite(file: string) {
  hooks?.openSqlite?.(file)
}

export function resetListCache() {
  sessionLists.clear()
  walks.clear()
  jsonFiles.clear()
  jsonlFiles.clear()
}

export function fileStamp(file: string) {
  if (!existsSync(file)) return "0"
  const info = statSync(file)
  return `${info.mtimeMs}:${info.size}`
}

export function storeStamp(file: string) {
  return [file, `${file}-wal`].map((path) => {
    if (!existsSync(path)) return "0"
    return String(statSync(path).mtimeMs)
  }).join(":")
}

export async function directoryStamp(root: string): Promise<string> {
  const info = await stat(root).catch(() => undefined)
  if (!info) return "0"
  const parts = [`${root}:${info.mtimeMs}`]
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    parts.push(await directoryStamp(path.join(root, entry.name)))
  }
  return parts.join("|")
}

export function cachedSessions(key: string, stamp: string, now: number, load: () => SessionSummary[]): SessionSummary[] {
  const hit = sessionLists.get(key)
  if (hit && hit.stamp === stamp) return refreshLive(hit.sessions, now)
  const sessions = load()
  sessionLists.set(key, { stamp, sessions })
  return sessions
}

export async function cachedSessionsAsync(
  key: string,
  stamp: string,
  now: number,
  load: () => Promise<SessionSummary[]>,
): Promise<SessionSummary[]> {
  const hit = sessionLists.get(key)
  if (hit && hit.stamp === stamp) return refreshLive(hit.sessions, now)
  const sessions = await load()
  sessionLists.set(key, { stamp, sessions })
  return sessions
}

export async function cachedFileSessions(
  file: string,
  now: number,
  load: () => Promise<SessionSummary[]>,
): Promise<SessionSummary[]> {
  return cachedSessionsAsync(file, fileStamp(file), now, load)
}

export async function walkFilesCached(
  root: string,
  id: string,
  match: (name: string, full: string) => boolean,
): Promise<string[]> {
  const stamp = await directoryStamp(root)
  const key = `${id}:${root}`
  const hit = walks.get(key)
  if (hit && hit.stamp === stamp) return hit.files
  noteWalk(root)
  const files = await walkFiles(root, match)
  walks.set(key, { stamp, files })
  return files
}

export async function readJsonCached(file: string): Promise<unknown> {
  const stamp = fileStamp(file)
  if (stamp === "0") return
  const hit = jsonFiles.get(file)
  if (hit && hit.stamp === stamp) return hit.value
  const value = await Bun.file(file)
    .json()
    .catch(() => undefined)
  jsonFiles.set(file, { stamp, value })
  return value
}

export async function readJsonlCached(file: string): Promise<unknown[]> {
  const stamp = fileStamp(file)
  if (stamp === "0") return []
  const hit = jsonlFiles.get(file)
  if (hit && hit.stamp === stamp) return hit.value
  const value = await readJsonl(file)
  jsonlFiles.set(file, { stamp, value })
  return value
}

function refreshLive(sessions: SessionSummary[], now: number) {
  return sessions.map((session) => ({
    ...session,
    live: markLive(session.updatedAt, now, session.active),
  }))
}
