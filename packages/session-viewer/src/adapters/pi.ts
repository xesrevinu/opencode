import { stat } from "node:fs/promises"
import path from "node:path"
import { cachedFileSessions, walkFilesCached } from "../list-cache"
import { readJsonl, readJsonlHead } from "../jsonl"
import { markLive } from "../live"
import type { SessionSummary, SessionTranscript, ToolStatus, TranscriptPart } from "../model"
import { asRecord, asString, cwdFromEncodedName, formatJson, nextId, textFromContent, timestampMs, titleFromText } from "../text"

export async function listPi(home: string, now: number): Promise<SessionSummary[]> {
  const files = await walkFilesCached(path.join(home, "agent", "sessions"), "pi", (name) => name.endsWith(".jsonl"))
  const summaries = await Promise.all(files.map((file) => cachedFileSessions(file, now, () => summarize(file, now))))
  return summaries.flat()
}

export async function loadPi(summary: SessionSummary): Promise<SessionTranscript> {
  const events = await readJsonl(summary.sourcePath)
  const parts: TranscriptPart[] = []
  const tools = new Map<string, number>()
  let index = 0
  let model = summary.model
  for (const record of currentBranch(events)) {
    const type = asString(record.type)
    const timestamp = timestampMs(record.timestamp)
    if (type === "session" || type === "thinking_level_change") continue
    if (type === "model_change") {
      model = formatModel(asString(record.provider), asString(record.modelId)) ?? model
      continue
    }
    if (type === "compaction") {
      const text = asString(record.summary)
      if (!text) continue
      parts.push({ type: "assistant", id: asString(record.id) ?? nextId("pi-compact", index++), text, timestamp })
      continue
    }
    if (type === "custom_message") {
      if (asString(record.customType) === "subagent-notification") continue
      const text = customMessageText(record)
      if (!text) continue
      parts.push({ type: "system", id: asString(record.id) ?? nextId("pi-note", index++), text, timestamp })
      continue
    }
    if (type === "custom") {
      pushCustom(record, timestamp, parts)
      continue
    }
    if (type !== "message") continue
    const message = asRecord(record.message)
    if (!message) continue
    const role = asString(message.role)
    if (role === "user") {
      const text = textFromContent(message.content)
      if (!text) continue
      parts.push({ type: "user", id: asString(record.id) ?? nextId("pi", index++), text, timestamp })
      continue
    }
    if (role === "assistant") {
      pushAssistant(message, asString(record.id) ?? nextId("pi", index++), timestamp, parts, tools)
      const error = asString(message.errorMessage)
      if (!error) continue
      parts.push({ type: "system", id: nextId("pi-error", index++), text: error, timestamp })
      continue
    }
    if (role !== "toolResult") continue
    const id = asString(message.toolCallId) ?? nextId("pi-tool", index++)
    const output = textFromContent(message.content)
    const status: ToolStatus = message.isError === true ? "error" : "completed"
    const existing = tools.get(id)
    if (existing === undefined) {
      parts.push({
        type: "tool",
        id,
        name: asString(message.toolName) ?? "tool",
        input: "",
        output,
        status,
        timestamp,
        metadata: asRecord(message.details),
      })
      continue
    }
    const part = parts[existing]
    if (part?.type !== "tool") continue
    parts[existing] = {
      ...part,
      output,
      status,
      name: asString(message.toolName) ?? part.name,
      metadata: asRecord(message.details) ?? part.metadata,
    }
  }
  return { summary: { ...summary, model }, parts }
}

async function summarize(file: string, now: number): Promise<SessionSummary[]> {
  const info = await stat(file).catch(() => undefined)
  if (!info) return []
  const head = await readJsonlHead(file, 12)
  const session = head.map(asRecord).find((row) => row?.type === "session")
  const id = asString(session?.id) ?? path.basename(file).replace(/\.jsonl$/, "").split("_").at(-1) ?? path.basename(file)
  const cwd = asString(session?.cwd) ?? cwdFromEncodedName(path.basename(path.dirname(file)))
  const modelRow = head.map(asRecord).find((row) => row?.type === "model_change")
  const firstUser = head
    .map(asRecord)
    .find((row) => row?.type === "message" && asRecord(row.message)?.role === "user")
  const text = textFromContent(asRecord(firstUser?.message)?.content)
  const createdAt = timestampMs(session?.timestamp) ?? info.birthtimeMs
  const updatedAt = info.mtimeMs
  return [
    {
      id,
      agent: "pi",
      title: titleFromText(text, id),
      cwd,
      model: formatModel(asString(modelRow?.provider), asString(modelRow?.modelId)),
      createdAt,
      updatedAt,
      live: markLive(updatedAt, now),
      sourcePath: file,
    },
  ]
}

function currentBranch(events: unknown[]) {
  const rows = events.flatMap((event) => {
    const record = asRecord(event)
    return record && asString(record.id) ? [record] : []
  })
  if (rows.length === 0) return []
  if (!rows.some((row) => asString(row.parentId))) return rows
  const byId = new Map(rows.map((row) => [asString(row.id)!, row]))
  const chain: Record<string, unknown>[] = []
  const seen = new Set<string>()
  let current = rows.at(-1)
  while (current) {
    const id = asString(current.id)
    if (!id || seen.has(id)) break
    seen.add(id)
    chain.push(current)
    const parentId = asString(current.parentId)
    current = parentId ? byId.get(parentId) : undefined
  }
  return chain.reverse()
}

function pushAssistant(
  message: Record<string, unknown>,
  id: string,
  timestamp: number | undefined,
  parts: TranscriptPart[],
  tools: Map<string, number>,
) {
  const content = message.content
  if (!Array.isArray(content)) {
    const text = textFromContent(content)
    if (text) parts.push({ type: "assistant", id, text, timestamp })
    return
  }
  let ordinal = 0
  for (const item of content) {
    const record = asRecord(item)
    if (!record) continue
    const kind = asString(record.type)
    if (kind === "thinking") {
      const text = asString(record.thinking)
      if (!text) continue
      parts.push({ type: "reasoning", id: `${id}-think-${ordinal++}`, text, completed: true, timestamp })
      continue
    }
    if (kind === "text") {
      const text = asString(record.text)
      if (!text) continue
      parts.push({ type: "assistant", id: `${id}-text-${ordinal++}`, text, timestamp })
      continue
    }
    if (kind !== "toolCall" && kind !== "tool_use") continue
    const toolId = asString(record.id) ?? asString(record.toolCallId) ?? asString(record.call_id)
    if (!toolId) continue
    tools.set(toolId, parts.length)
    parts.push({
      type: "tool",
      id: toolId,
      name: asString(record.name) ?? asString(record.toolName) ?? "tool",
      input: formatJson(record.arguments ?? record.input),
      status: "running",
      timestamp,
    })
  }
}

function pushCustom(record: Record<string, unknown>, timestamp: number | undefined, parts: TranscriptPart[]) {
  if (asString(record.customType) !== "subagents:record") return
  const data = asRecord(record.data)
  if (!data) return
  const id = asString(data.id) ?? asString(record.id)
  if (!id) return
  const error = asString(data.error)
  parts.push({
    type: "tool",
    id,
    name: "Agent",
    input: formatJson({ agent: asString(data.type), description: asString(data.description) }),
    output: asString(data.result) || error,
    status: error || asString(data.status) === "error" ? "error" : "completed",
    timestamp,
  })
}

function customMessageText(record: Record<string, unknown>) {
  const details = asRecord(record.details)
  return asString(details?.summary) ?? asString(record.content)
}

function formatModel(provider?: string, modelId?: string) {
  if (provider && modelId) return `${provider}/${modelId}`
  return modelId ?? provider
}
