import { stat } from "node:fs/promises"
import path from "node:path"
import { readJsonl, readJsonlHead, walkFiles } from "../jsonl"
import { markLive } from "../live"
import type { SessionSummary, SessionTranscript, TranscriptPart } from "../model"
import { asRecord, asString, cwdFromEncodedName, formatJson, nextId, textFromContent, timestampMs, titleFromText } from "../text"

export async function listClaude(home: string, now: number): Promise<SessionSummary[]> {
  const files = await walkFiles(path.join(home, "projects"), (name) => name.endsWith(".jsonl"))
  const summaries = await Promise.all(files.map((file) => summarize(file, now)))
  return summaries.flat()
}

export async function loadClaude(summary: SessionSummary): Promise<SessionTranscript> {
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
    if (type === "user") {
      const toolResults = Array.isArray(message?.content)
        ? message.content.flatMap((item) => {
            const row = asRecord(item)
            return row?.type === "tool_result" ? [row] : []
          })
        : []
      if (toolResults.length > 0) {
        for (const result of toolResults) {
          const id = asString(result.tool_use_id) ?? nextId("claude-tool", index++)
          const output = textFromContent(result.content) || asString(result.content) || ""
          const existing = tools.get(id)
          if (existing === undefined) {
            parts.push({ type: "tool", id, name: "tool", input: "", output, status: "completed", timestamp })
            continue
          }
          const part = parts[existing]
          if (part?.type === "tool") parts[existing] = { ...part, output, status: "completed" }
        }
        continue
      }
      const text = textFromContent(message?.content) || asString(asRecord(message)?.content) || ""
      if (!text) continue
      parts.push({ type: "user", id: asString(record.uuid) ?? nextId("claude", index++), text, timestamp })
      continue
    }
    if (type !== "assistant" || !message) continue
    const content = message.content
    if (!Array.isArray(content)) {
      const text = textFromContent(content)
      if (text) parts.push({ type: "assistant", id: asString(record.uuid) ?? nextId("claude", index++), text, timestamp })
      continue
    }
    for (const item of content) {
      const row = asRecord(item)
      if (!row) continue
      if (row.type === "text") {
        const text = asString(row.text) ?? ""
        if (text) parts.push({ type: "assistant", id: asString(record.uuid) ?? nextId("claude", index++), text, timestamp })
        continue
      }
      if (row.type === "thinking" || row.type === "reasoning") {
        parts.push({
          type: "reasoning",
          id: nextId("claude-reason", index++),
          text: asString(row.thinking) ?? asString(row.text) ?? "",
          completed: true,
          timestamp,
        })
        continue
      }
      if (row.type !== "tool_use") continue
      const id = asString(row.id) ?? nextId("claude-tool", index++)
      tools.set(id, parts.length)
      parts.push({
        type: "tool",
        id,
        name: asString(row.name) ?? "tool",
        input: formatJson(row.input),
        status: "running",
        timestamp,
      })
    }
  }
  return { summary, parts }
}

async function summarize(file: string, now: number): Promise<SessionSummary[]> {
  const info = await stat(file).catch(() => undefined)
  if (!info) return []
  const head = await readJsonlHead(file, 16)
  const first = head.map(asRecord).find((row) => row?.type === "user" && asRecord(row.message))
  const id =
    asString(first?.sessionId) ??
    asString(head.map(asRecord).find((row) => asString(row?.sessionId))?.sessionId) ??
    path.basename(file, ".jsonl")
  const cwd = asString(first?.cwd) ?? cwdFromEncodedName(path.basename(path.dirname(file)))
  const text = textFromContent(asRecord(first?.message)?.content)
  const createdAt = timestampMs(first?.timestamp) ?? info.birthtimeMs
  const updatedAt = info.mtimeMs
  return [
    {
      id,
      agent: "claude",
      title: titleFromText(text, id),
      cwd,
      createdAt,
      updatedAt,
      live: markLive(updatedAt, now),
      sourcePath: file,
    },
  ]
}
