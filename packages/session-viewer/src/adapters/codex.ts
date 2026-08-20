import { stat } from "node:fs/promises"
import path from "node:path"
import { cachedFileSessions, readJsonlCached, walkFilesCached } from "../list-cache"
import { readJsonl, readJsonlHead } from "../jsonl"
import { markLive } from "../live"
import type { SessionSummary, SessionTranscript, TranscriptPart } from "../model"
import { asRecord, asString, nextId, textFromContent, timestampMs, titleFromText } from "../text"

export async function listCodex(home: string, now: number): Promise<SessionSummary[]> {
  const titles = await loadIndexTitles(path.join(home, "session_index.jsonl"))
  const files = await walkFilesCached(path.join(home, "sessions"), "codex", (name) => name.endsWith(".jsonl"))
  const summaries = await Promise.all(files.map((file) => cachedFileSessions(file, now, () => summarize(file, titles, now))))
  return summaries.flat()
}

export async function loadCodex(summary: SessionSummary): Promise<SessionTranscript> {
  const events = await readJsonl(summary.sourcePath)
  const parts: TranscriptPart[] = []
  const tools = new Map<string, number>()
  let index = 0
  for (const event of events) {
    const record = asRecord(event)
    if (!record) continue
    const payload = asRecord(record.payload) ?? record
    const type = asString(payload.type) ?? asString(record.type)
    const timestamp = timestampMs(record.timestamp) ?? timestampMs(payload.timestamp)
    if (type === "session_meta") continue
    if (type === "message" || type === "agent_message") {
      const role = asString(payload.role)
      const text = textFromContent(payload.content) || asString(payload.message) || asString(payload.text) || ""
      if (!text) continue
      parts.push({
        type: role === "assistant" || type === "agent_message" ? "assistant" : "user",
        id: nextId("codex", index++),
        text,
        timestamp,
      })
      continue
    }
    if (type === "function_call") {
      const id = asString(payload.call_id) ?? nextId("codex-tool", index)
      tools.set(id, parts.length)
      parts.push({
        type: "tool",
        id,
        name: asString(payload.name) ?? "tool",
        input: asString(payload.arguments) ?? "",
        status: "running",
        timestamp,
      })
      index++
      continue
    }
    if (type === "function_call_output") {
      const id = asString(payload.call_id)
      const output = asString(payload.output) ?? textFromContent(payload.output)
      if (!id) continue
      const existing = tools.get(id)
      if (existing === undefined) {
        parts.push({ type: "tool", id, name: "tool", input: "", output, status: "completed", timestamp })
        continue
      }
      const part = parts[existing]
      if (part?.type === "tool") parts[existing] = { ...part, output, status: "completed" }
      continue
    }
    if (type === "reasoning" || type === "agent_reasoning") {
      const text = textFromContent(payload.summary) || textFromContent(payload.content) || asString(payload.text) || ""
      if (!text.trim()) continue
      parts.push({
        type: "reasoning",
        id: nextId("codex-reason", index++),
        text,
        completed: true,
        timestamp,
      })
    }
  }
  return { summary, parts }
}

async function summarize(file: string, titles: Map<string, string>, now: number): Promise<SessionSummary[]> {
  const info = await stat(file).catch(() => undefined)
  if (!info) return []
  const head = await readJsonlHead(file, 8)
  const meta = head.map(asRecord).find((row) => row && (row.type === "session_meta" || asRecord(row.payload)?.id))
  const payload = asRecord(meta?.payload) ?? meta
  const id =
    asString(payload?.id) ??
    path.basename(file).replace(/^rollout-.*?-/, "").replace(/\.jsonl$/, "")
  const cwd = asString(asRecord(payload)?.cwd)
  const model = formatCodexModel(asRecord(payload))
  const firstUser = firstUserText(head)
  const createdAt = timestampMs(payload?.timestamp) ?? info.birthtimeMs
  const eventTimes = head.flatMap((row) => {
    const record = asRecord(row)
    return [timestampMs(record?.timestamp), timestampMs(asRecord(record?.payload)?.timestamp)]
  })
  const updatedAt = Math.max(info.mtimeMs, createdAt, ...eventTimes.filter((value): value is number => value !== undefined))
  return [
    {
      id,
      agent: "codex",
      title: titles.get(id) ?? titleFromText(firstUser, id),
      cwd,
      model,
      createdAt,
      updatedAt,
      live: markLive(updatedAt, now),
      sourcePath: file,
    },
  ]
}

async function loadIndexTitles(file: string) {
  const titles = new Map<string, string>()
  for (const row of await readJsonlCached(file)) {
    const record = asRecord(row)
    const id = asString(record?.id)
    const title = asString(record?.thread_name)
    if (id && title) titles.set(id, title)
  }
  return titles
}

function formatCodexModel(payload?: Record<string, unknown>) {
  const provider = asString(payload?.model_provider)
  const model = asString(payload?.model)
  if (provider && model) return `${provider}/${model}`
  return model ?? provider
}

function firstUserText(rows: unknown[]) {
  for (const row of rows) {
    const record = asRecord(row)
    const payload = asRecord(record?.payload) ?? record
    if (!payload) continue
    if (payload.type !== "message" && record?.type !== "response_item") continue
    if (asString(payload.role) !== "user") continue
    const text = textFromContent(payload.content)
    if (text) return text
  }
  return ""
}
