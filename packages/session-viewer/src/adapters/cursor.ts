import { stat } from "node:fs/promises"
import path from "node:path"
import { readJsonl, readJsonlHead, walkFiles } from "../jsonl"
import { markLive } from "../live"
import type { SessionSummary, SessionTranscript, TranscriptPart } from "../model"
import { asRecord, asString, cwdFromEncodedName, formatJson, nextId, textFromContent, timestampMs, titleFromText } from "../text"

export async function listCursor(home: string, now: number): Promise<SessionSummary[]> {
  const files = await walkFiles(path.join(home, "projects"), (name, full) => {
    if (!name.endsWith(".jsonl")) return false
    return full.includes(`${path.sep}agent-transcripts${path.sep}`) && !full.includes(`${path.sep}subagents${path.sep}`)
  })
  const summaries = await Promise.all(files.map((file) => summarize(file, now)))
  return summaries.flat()
}

export async function loadCursor(summary: SessionSummary): Promise<SessionTranscript> {
  const events = await readJsonl(summary.sourcePath)
  const parts: TranscriptPart[] = []
  let index = 0
  for (const event of events) {
    const record = asRecord(event)
    if (!record) continue
    const role = asString(record.role) ?? asString(record.type)
    const message = asRecord(record.message)
    const timestamp = timestampMs(record.timestamp) ?? timestampMs(asRecord(record.message)?.timestamp)
    if (role === "turn_ended" || role === "system") continue
    if (role === "user") {
      const text = textFromContent(message?.content) || asString(message?.content) || ""
      if (!text) continue
      parts.push({ type: "user", id: asString(record.id) ?? nextId("cursor", index++), text, timestamp })
      continue
    }
    if (role !== "assistant" || !message) continue
    const content = message.content
    if (!Array.isArray(content)) {
      const text = textFromContent(content)
      if (text) parts.push({ type: "assistant", id: nextId("cursor", index++), text, timestamp })
      continue
    }
    for (const item of content) {
      const row = asRecord(item)
      if (!row) continue
      if (row.type === "text") {
        const text = asString(row.text) ?? ""
        if (text) parts.push({ type: "assistant", id: nextId("cursor", index++), text, timestamp })
        continue
      }
      if (row.type === "thinking" || row.type === "reasoning") {
        parts.push({
          type: "reasoning",
          id: nextId("cursor-reason", index++),
          text: asString(row.thinking) ?? asString(row.text) ?? "",
          completed: true,
          timestamp,
        })
        continue
      }
      if (row.type !== "tool_use") continue
      parts.push({
        type: "tool",
        id: asString(row.id) ?? nextId("cursor-tool", index++),
        name: asString(row.name) ?? "tool",
        input: formatJson(row.input),
        status: "completed",
        timestamp,
      })
    }
  }
  return { summary, parts }
}

async function summarize(file: string, now: number): Promise<SessionSummary[]> {
  const info = await stat(file).catch(() => undefined)
  if (!info) return []
  const head = await readJsonlHead(file, 12)
  const firstUser = head.map(asRecord).find((row) => row?.role === "user")
  const id = path.basename(file, ".jsonl")
  const project = cursorProjectName(file)
  const text = textFromContent(asRecord(firstUser?.message)?.content)
  const createdAt = timestampMs(firstUser?.timestamp) ?? info.birthtimeMs
  const updatedAt = info.mtimeMs
  return [
    {
      id,
      agent: "cursor",
      title: titleFromText(text, id),
      cwd: project ? cwdFromCursorProject(project) : undefined,
      createdAt,
      updatedAt,
      live: markLive(updatedAt, now),
      sourcePath: file,
    },
  ]
}

function cursorProjectName(file: string) {
  const marker = `${path.sep}projects${path.sep}`
  const index = file.indexOf(marker)
  if (index === -1) return
  const rest = file.slice(index + marker.length)
  return rest.split(path.sep)[0]
}

function cwdFromCursorProject(name: string) {
  return cwdFromEncodedName(`-${name.replace(/-github-com-/, "-github.com-")}`)
}
