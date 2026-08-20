import path from "node:path"
import { cachedSessionsAsync, fileStamp, readJsonCached, walkFilesCached } from "../list-cache"
import { readJsonl } from "../jsonl"
import { markLive } from "../live"
import type { SessionSummary, SessionTranscript, TranscriptPart } from "../model"
import { asRecord, asString, cwdFromEncodedName, formatJson, nextId, textFromContent, timestampMs, titleFromText } from "../text"

export async function listGrok(home: string, now: number): Promise<SessionSummary[]> {
  const activeFile = path.join(home, "active_sessions.json")
  const active = await loadActive(activeFile)
  const activeStamp = fileStamp(activeFile)
  const files = await walkFilesCached(path.join(home, "sessions"), "grok", (name) => name === "summary.json")
  const summaries = await Promise.all(
    files.map((file) =>
      cachedSessionsAsync(`grok:${file}`, `${fileStamp(file)}|${activeStamp}`, now, () => summarize(file, active, now)),
    ),
  )
  return summaries.flat()
}

export async function loadGrok(summary: SessionSummary): Promise<SessionTranscript> {
  const events = await readJsonl(path.join(path.dirname(summary.sourcePath), "chat_history.jsonl"))
  const parts: TranscriptPart[] = []
  const tools = new Map<string, number>()
  let index = 0
  let model = summary.model
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
      const text = textFromContent(record.summary) || textFromContent(record.content) || asString(record.text) || ""
      if (!text.trim()) continue
      parts.push({
        type: "reasoning",
        id: asString(record.id) ?? nextId("grok-reason", index++),
        text,
        completed: true,
        timestamp,
      })
      continue
    }
    if (type === "backend_tool_call") {
      const kind = asRecord(record.kind)
      const action = asRecord(kind?.action)
      const id = asString(kind?.id) ?? nextId("grok-backend", index++)
      const query = asString(action?.query)
      const sources = Array.isArray(action?.sources)
        ? action.sources.flatMap((item) => {
            const source = asRecord(item)
            const url = asString(source?.url)
            return url ? [url] : []
          })
        : []
      parts.push({
        type: "tool",
        id,
        name: asString(kind?.tool_type) ?? "web_search",
        input: formatJson({ query, ...(asRecord(action) ?? {}) }),
        output: sources.join("\n"),
        status: asString(kind?.status) === "error" ? "error" : "completed",
        timestamp,
      })
      continue
    }
    if (type === "assistant") {
      model = asString(record.model_id) ?? model
      const text = typeof record.content === "string" ? record.content : textFromContent(record.content)
      if (text) parts.push({ type: "assistant", id: nextId("grok", index++), text, timestamp })
      const calls = record.tool_calls
      if (!Array.isArray(calls)) continue
      for (const call of calls) {
        const item = asRecord(call)
        if (!item) continue
        const fn = asRecord(item.function)
        const id = asString(item.id) ?? nextId("grok-tool", index++)
        tools.set(id, parts.length)
        parts.push({
          type: "tool",
          id,
          name: asString(item.name) ?? asString(fn?.name) ?? "tool",
          input: formatJson(item.arguments ?? item.input ?? fn?.arguments),
          status: "running",
          timestamp,
        })
      }
      continue
    }
    if (type === "tool_result") {
      const id = asString(record.tool_call_id) ?? nextId("grok-tool", index++)
      const raw = typeof record.content === "string" ? record.content : textFromContent(record.content)
      const existing = tools.get(id)
      if (existing === undefined) {
        const parsed = grokToolOutput(raw)
        parts.push({ type: "tool", id, name: "tool", input: "", ...parsed, status: "completed", timestamp })
        continue
      }
      const part = parts[existing]
      if (part?.type !== "tool") continue
      parts[existing] = { ...part, ...grokToolOutput(raw, part), status: "completed" }
    }
  }
  return { summary: { ...summary, model }, parts }
}

function grokToolOutput(raw: string, part?: Extract<TranscriptPart, { type: "tool" }>) {
  const match = raw.match(/^exit:\s*(-?\d+)\n?([\s\S]*)$/)
  if (!match) return { output: raw, metadata: part?.metadata }
  return {
    output: match[2],
    metadata: { ...part?.metadata, exit: Number(match[1]) },
  }
}

async function summarize(file: string, active: Set<string>, now: number): Promise<SessionSummary[]> {
  const record = asRecord(await readJsonCached(file))
  if (!record) return []
  const info = asRecord(record.info)
  const id = asString(info?.id) ?? asString(record.id) ?? path.basename(path.dirname(file))
  const cwd = asString(info?.cwd) ?? cwdFromEncodedName(path.basename(path.dirname(path.dirname(file))))
  const createdAt = timestampMs(record.created_at) ?? 0
  const stamp = fileStamp(file)
  const updatedAt = timestampMs(record.last_active_at) ?? timestampMs(record.updated_at) ?? Number(stamp.split(":")[0])
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
      active: active.has(id),
      messageCount: typeof record.num_messages === "number" ? record.num_messages : undefined,
      sourcePath: file,
    },
  ]
}

async function loadActive(file: string) {
  const raw = await readJsonCached(file)
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
