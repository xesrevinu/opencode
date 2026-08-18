import { stat } from "node:fs/promises"
import path from "node:path"
import { readJsonl, walkFiles } from "../jsonl"
import { markLive } from "../live"
import type { SessionSummary, SessionTranscript, TranscriptPart } from "../model"
import { asRecord, asString, cwdFromEncodedName, formatJson, nextId, textFromContent, timestampMs, titleFromText } from "../text"

export async function listGrok(home: string, now: number): Promise<SessionSummary[]> {
  const active = await loadActive(path.join(home, "active_sessions.json"))
  const files = await walkFiles(path.join(home, "sessions"), (name) => name === "summary.json")
  const summaries = await Promise.all(files.map((file) => summarize(file, active, now)))
  return summaries.flat()
}

export async function loadGrok(summary: SessionSummary): Promise<SessionTranscript> {
  const events = await readJsonl(path.join(path.dirname(summary.sourcePath), "chat_history.jsonl"))
  const parts: TranscriptPart[] = []
  const tools = new Map<string, number>()
  let index = 0
  for (const event of events) {
    const record = asRecord(event)
    if (!record) continue
    const type = asString(record.type)
    const timestamp = timestampMs(record.timestamp)
    if (type === "system") continue
    if (type === "user") {
      const text = textFromContent(record.content)
      if (!text) continue
      parts.push({ type: "user", id: nextId("grok", index++), text, timestamp })
      continue
    }
    if (type === "reasoning") {
      parts.push({
        type: "reasoning",
        id: asString(record.id) ?? nextId("grok-reason", index++),
        text: textFromContent(record.summary) || textFromContent(record.content) || asString(record.text) || "",
        completed: true,
        timestamp,
      })
      continue
    }
    if (type === "assistant") {
      const text = typeof record.content === "string" ? record.content : textFromContent(record.content)
      if (text) parts.push({ type: "assistant", id: nextId("grok", index++), text, timestamp })
      const calls = record.tool_calls
      if (!Array.isArray(calls)) continue
      for (const call of calls) {
        const item = asRecord(call)
        if (!item) continue
        const id = asString(item.id) ?? nextId("grok-tool", index++)
        tools.set(id, parts.length)
        parts.push({
          type: "tool",
          id,
          name: asString(item.name) ?? "tool",
          input: formatJson(item.arguments ?? item.input),
          status: "running",
          timestamp,
        })
      }
      continue
    }
    if (type === "tool_result") {
      const id = asString(record.tool_call_id) ?? nextId("grok-tool", index++)
      const output = typeof record.content === "string" ? record.content : textFromContent(record.content)
      const existing = tools.get(id)
      if (existing === undefined) {
        parts.push({ type: "tool", id, name: "tool", input: "", output, status: "completed", timestamp })
        continue
      }
      const part = parts[existing]
      if (part?.type === "tool") parts[existing] = { ...part, output, status: "completed" }
    }
  }
  return { summary, parts }
}

async function summarize(file: string, active: Set<string>, now: number): Promise<SessionSummary[]> {
  const raw = await Bun.file(file)
    .json()
    .catch(() => undefined)
  const record = asRecord(raw)
  if (!record) return []
  const info = asRecord(record.info)
  const id = asString(info?.id) ?? asString(record.id) ?? path.basename(path.dirname(file))
  const cwd = asString(info?.cwd) ?? cwdFromEncodedName(path.basename(path.dirname(path.dirname(file))))
  const createdAt = timestampMs(record.created_at) ?? 0
  const updatedAt = timestampMs(record.last_active_at) ?? timestampMs(record.updated_at) ?? (await mtime(file))
  return [
    {
      id,
      agent: "grok",
      title: asString(record.generated_title) ?? asString(record.session_summary) ?? titleFromText(id, id),
      cwd,
      model: asString(record.current_model_id),
      createdAt,
      updatedAt,
      live: markLive(updatedAt, now, active.has(id)),
      messageCount: typeof record.num_messages === "number" ? record.num_messages : undefined,
      sourcePath: file,
    },
  ]
}

async function loadActive(file: string) {
  const raw = await Bun.file(file)
    .json()
    .catch(() => [])
  const ids = new Set<string>()
  if (!Array.isArray(raw)) return ids
  for (const item of raw) {
    if (typeof item === "string") {
      ids.add(item)
      continue
    }
    const id = asString(asRecord(item)?.id)
    if (id) ids.add(id)
  }
  return ids
}

async function mtime(file: string) {
  const info = await stat(file).catch(() => undefined)
  return info?.mtimeMs ?? 0
}
