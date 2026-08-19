import { readdir } from "node:fs/promises"
import path from "node:path"
import { markLive } from "../live"
import type { SessionSummary, SessionTranscript, TranscriptPart } from "../model"
import { openReadonlyDatabase } from "../sqlite"
import { asRecord, asString, formatJson, nextId, textFromContent, titleFromText } from "../text"

export async function listOpencode(home: string, now: number): Promise<SessionSummary[]> {
  const files = await listDatabases(home)
  const byId = new Map<string, SessionSummary>()
  for (const file of files) {
    for (const session of readSessions(file, now)) {
      const existing = byId.get(session.id)
      if (!existing || session.updatedAt > existing.updatedAt) byId.set(session.id, session)
    }
  }
  return [...byId.values()]
}

export async function loadOpencode(summary: SessionSummary): Promise<SessionTranscript> {
  const db = open(summary.sourcePath)
  if (!db) return { summary, parts: [] }
  try {
    const rows = db
      .query("SELECT id, type, data, time_created FROM session_message WHERE session_id = ? ORDER BY seq")
      .all(summary.id) as { id: string; type: string; data: string; time_created: number }[]
    const parts: TranscriptPart[] = []
    let index = 0
    for (const row of rows) {
      const data = parseData(row.data)
      const timestamp = row.time_created
      if (row.type === "user") {
        const text = asString(data.text) ?? textFromContent(data.content)
        if (!text) continue
        parts.push({ type: "user", id: row.id, text, timestamp })
        continue
      }
      if (row.type !== "assistant") continue
      const content = data.content
      if (!Array.isArray(content)) {
        const text = asString(data.text) ?? ""
        if (text) parts.push({ type: "assistant", id: row.id, text, timestamp })
        continue
      }
      for (const item of content) {
        const record = asRecord(item)
        if (!record) continue
        if (record.type === "text") {
          const text = asString(record.text) ?? ""
          if (text) parts.push({ type: "assistant", id: asString(record.id) ?? `${row.id}-${index++}`, text, timestamp })
          continue
        }
        if (record.type === "reasoning") {
          parts.push({
            type: "reasoning",
            id: asString(record.id) ?? nextId("oc-reason", index++),
            text: asString(record.text) ?? "",
            completed: Boolean(asRecord(record.time)?.completed),
            timestamp,
          })
          continue
        }
        if (record.type !== "tool") continue
        const state = asRecord(record.state)
        const contentText = Array.isArray(state?.content)
          ? state.content
              .map((entry) => asString(asRecord(entry)?.text) ?? "")
              .filter(Boolean)
              .join("\n")
          : asString(state?.output) ?? ""
        parts.push({
          type: "tool",
          id: asString(record.id) ?? nextId("oc-tool", index++),
          name: asString(record.name) ?? "tool",
          input: formatJson(state?.input ?? record.input),
          output: contentText || undefined,
          status: toolStatus(asString(state?.status)),
          timestamp,
          metadata: asRecord(state?.metadata),
        })
      }
    }
    return { summary, parts }
  } finally {
    db.close()
  }
}

async function listDatabases(home: string) {
  const names = await readdir(home).catch(() => [])
  return names.filter((name) => /^opencode.*\.db$/.test(name)).map((name) => path.join(home, name))
}

function readSessions(file: string, now: number): SessionSummary[] {
  const db = open(file)
  if (!db) return []
  try {
    const pending = new Set(
      db
        .query("SELECT DISTINCT session_id FROM session_pending")
        .all()
        .map((row) => asString(asRecord(row)?.session_id))
        .filter((id): id is string => Boolean(id)),
    )
    return (
      db
        .query(
          "SELECT id, title, directory, model, time_created, time_updated FROM session_v2 WHERE time_archived IS NULL",
        )
        .all() as {
        id: string
        title: string | null
        directory: string
        model: string | null
        time_created: number
        time_updated: number
      }[]
    ).map((row) => ({
      id: row.id,
      agent: "opencode" as const,
      title: row.title?.trim() || titleFromText(row.id, row.id),
      cwd: row.directory,
      model: modelLabel(row.model),
      createdAt: row.time_created,
      updatedAt: row.time_updated,
      live: markLive(row.time_updated, now, pending.has(row.id)),
      sourcePath: file,
    }))
  } catch {
    return []
  } finally {
    db.close()
  }
}

function open(file: string) {
  return openReadonlyDatabase(file)
}

function parseData(raw: string) {
  try {
    return asRecord(JSON.parse(raw)) ?? {}
  } catch {
    return {}
  }
}

function modelLabel(raw: string | null) {
  if (!raw) return
  try {
    const record = asRecord(JSON.parse(raw))
    const id = asString(record?.id)
    const provider = asString(record?.providerID)
    if (id && provider) return `${provider}/${id}`
    return id
  } catch {
    return raw
  }
}

function toolStatus(status: string | undefined) {
  if (status === "error") return "error" as const
  if (status === "completed") return "completed" as const
  if (status === "pending") return "pending" as const
  return "running" as const
}

export function parseOpencodeModel(raw: string | null) {
  return modelLabel(raw)
}
