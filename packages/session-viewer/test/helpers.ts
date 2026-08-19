import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export async function tempRoot(name: string) {
  const root = path.join(os.tmpdir(), `session-viewer-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(root, { recursive: true })
  return root
}

export async function writeJsonl(file: string, rows: unknown[]) {
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n")
}

export async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify(value, null, 2))
}

export type CursorHeaderFixture = {
  composerId: string
  workspaceId?: string
  createdAt?: number
  lastUpdatedAt?: number | null
  isArchived?: number
  isSubagent?: number
  recency?: number
  value: Record<string, unknown>
}

export async function writeCursorStore(
  file: string,
  input: {
    kv?: { key: string; value: unknown }[]
    headers?: CursorHeaderFixture[]
  },
) {
  await mkdir(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.run("CREATE TABLE cursorDiskKV (key text PRIMARY KEY, value text)")
  db.run(`CREATE TABLE composerHeaders (
    composerId TEXT PRIMARY KEY,
    workspaceId TEXT,
    createdAt INTEGER,
    lastUpdatedAt INTEGER,
    isArchived INTEGER,
    isSubagent INTEGER,
    recency INTEGER,
    checkpointAt INTEGER,
    value TEXT
  )`)
  const insertKv = db.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)")
  for (const row of input.kv ?? []) insertKv.run(row.key, JSON.stringify(row.value))
  const insertHeader = db.prepare(
    "INSERT INTO composerHeaders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
  for (const row of input.headers ?? []) {
    insertHeader.run(
      row.composerId,
      row.workspaceId ?? "ws",
      row.createdAt ?? Date.parse("2026-08-19T00:00:00.000Z"),
      row.lastUpdatedAt ?? Date.parse("2026-08-19T00:00:00.000Z"),
      row.isArchived ?? 0,
      row.isSubagent ?? 0,
      row.recency ?? row.lastUpdatedAt ?? Date.parse("2026-08-19T00:00:00.000Z"),
      null,
      JSON.stringify(row.value),
    )
  }
  db.close()
}
