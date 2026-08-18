import { stat } from "node:fs/promises"
import path from "node:path"
import { readJsonl, readJsonlHead, walkFiles } from "../jsonl"
import { markLive } from "../live"
import type { SessionSummary, SessionTranscript, TranscriptPart } from "../model"
import { asRecord, asString, cwdFromEncodedName, formatJson, nextId, textFromContent, timestampMs, titleFromText } from "../text"

export async function listPi(home: string, now: number): Promise<SessionSummary[]> {
  const files = await walkFiles(path.join(home, "agent", "sessions"), (name) => name.endsWith(".jsonl"))
  const summaries = await Promise.all(files.map((file) => summarize(file, now)))
  return summaries.flat()
}

export async function loadPi(summary: SessionSummary): Promise<SessionTranscript> {
  const events = await readJsonl(summary.sourcePath)
  const parts: TranscriptPart[] = []
  const tools = new Map<string, number>()
  let index = 0
  for (const event of events) {
    const record = asRecord(event)
    if (!record) continue
    const type = asString(record.type)
    const timestamp = timestampMs(record.timestamp)
    const message = asRecord(record.message)
    if (type === "session" || type === "model_change" || type === "thinking_level_change") continue
    if (type !== "message" || !message) continue
    const role = asString(message.role)
    if (role === "user") {
      const text = textFromContent(message.content)
      if (!text) continue
      parts.push({ type: "user", id: asString(record.id) ?? nextId("pi", index++), text, timestamp })
      continue
    }
    if (role === "assistant") {
      pushAssistant(message, asString(record.id) ?? nextId("pi", index++), timestamp, parts, tools)
      continue
    }
    if (role === "toolResult") {
      const id = asString(message.toolCallId) ?? nextId("pi-tool", index++)
      const output = textFromContent(message.content)
      const existing = tools.get(id)
      if (existing === undefined) {
        parts.push({
          type: "tool",
          id,
          name: asString(message.toolName) ?? "tool",
          input: "",
          output,
          status: "completed",
          timestamp,
        })
        continue
      }
      const part = parts[existing]
      if (part?.type === "tool") parts[existing] = { ...part, output, status: "completed", name: asString(message.toolName) ?? part.name }
    }
  }
  return { summary, parts }
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
      model: asString(modelRow?.modelId),
      createdAt,
      updatedAt,
      live: markLive(updatedAt, now),
      sourcePath: file,
    },
  ]
}

function pushAssistant(
  message: Record<string, unknown>,
  id: string,
  timestamp: number | undefined,
  parts: TranscriptPart[],
  tools: Map<string, number>,
) {
  const text = textFromContent(message.content)
  if (text) parts.push({ type: "assistant", id, text, timestamp })
  const content = message.content
  if (!Array.isArray(content)) return
  for (const item of content) {
    const record = asRecord(item)
    if (!record) continue
    if (record.type !== "toolCall" && record.type !== "tool_use" && !record.toolCallId && !record.id) continue
    if (record.type === "text") continue
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
