import { stat } from "node:fs/promises"
import path from "node:path"
import { readJsonl, readJsonlHead, walkFiles } from "../jsonl"
import { markLive } from "../live"
import type { SessionSummary, SessionTranscript, ToolStatus, TranscriptPart } from "../model"
import { asRecord, asString, cwdFromEncodedName, formatJson, nextId, textFromContent, timestampMs, titleFromText } from "../text"
import { listCursorStore, loadCursorStore } from "./cursor-store"

const jsonlCache = new Map<string, { stamp: string; sessions: SessionSummary[] }>()

export async function listCursor(home: string, now: number): Promise<SessionSummary[]> {
  const store = listCursorStore(home, now)
  const jsonl = await listCursorJsonl(home, now)
  const seen = new Set(store.map((session) => session.id))
  return [...store, ...jsonl.filter((session) => !seen.has(session.id))]
}

export async function loadCursor(summary: SessionSummary): Promise<SessionTranscript> {
  if (summary.sourcePath.endsWith(".vscdb")) return loadCursorStore(summary)
  return loadCursorJsonl(summary)
}

async function listCursorJsonl(home: string, now: number): Promise<SessionSummary[]> {
  const files = await walkFiles(path.join(home, "projects"), (name, full) => {
    if (!name.endsWith(".jsonl")) return false
    return full.includes(`${path.sep}agent-transcripts${path.sep}`) && !full.includes(`${path.sep}subagents${path.sep}`)
  })
  const stats = await Promise.all(
    files.map(async (file) => {
      const info = await stat(file).catch(() => undefined)
      return { file, mtime: info?.mtimeMs ?? 0, size: info?.size ?? 0 }
    }),
  )
  const stamp = stats
    .map((row) => `${row.file}:${row.mtime}:${row.size}`)
    .sort()
    .join("\n")
  const cached = jsonlCache.get(home)
  if (cached && cached.stamp === stamp) {
    return cached.sessions.map((session) => ({ ...session, live: markLive(session.updatedAt, now) }))
  }
  const sessions = (await Promise.all(stats.map((row) => summarize(row.file, now, row.mtime)))).flat()
  jsonlCache.set(home, { stamp, sessions })
  return sessions
}

async function loadCursorJsonl(summary: SessionSummary): Promise<SessionTranscript> {
  const events = await readJsonl(summary.sourcePath)
  const parts: TranscriptPart[] = []
  const tools = new Map<string, number>()
  let index = 0
  for (const event of events) {
    const record = asRecord(event)
    if (!record) continue
    const role = asString(record.role) ?? asString(record.type)
    const message = asRecord(record.message)
    const timestamp = timestampMs(record.timestamp) ?? timestampMs(asRecord(record.message)?.timestamp)
    if (role === "turn_ended" || role === "system") continue
    if (role === "tool_result") {
      applyToolResult(parts, tools, asString(record.tool_use_id) ?? asString(record.toolCallId), textFromContent(record.content) || asString(record.content), timestamp)
      continue
    }
    if (role === "user") {
      const content = message?.content
      const textItems = Array.isArray(content)
        ? content.filter((item) => asRecord(item)?.type !== "tool_result")
        : content
      if (Array.isArray(content)) {
        for (const item of content) {
          const row = asRecord(item)
          if (row?.type !== "tool_result") continue
          applyToolResult(parts, tools, asString(row.tool_use_id), textFromContent(row.content) || asString(row.content), timestamp)
        }
      }
      const text = textFromContent(textItems) || asString(textItems) || ""
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
      const id = asString(row.id) ?? nextId("cursor-tool", index++)
      tools.set(id, parts.length)
      parts.push({
        type: "tool",
        id,
        name: asString(row.name) ?? "tool",
        input: formatJson(row.input),
        status: jsonlToolStatus(row),
        timestamp,
      })
    }
  }
  return { summary, parts }
}

function applyToolResult(
  parts: TranscriptPart[],
  tools: Map<string, number>,
  id: string | undefined,
  output: string | undefined,
  timestamp?: number,
) {
  if (!id) return
  const existing = tools.get(id)
  if (existing === undefined) {
    parts.push({ type: "tool", id, name: "tool", input: "", output, status: "completed", timestamp })
    return
  }
  const part = parts[existing]
  if (part?.type === "tool") parts[existing] = { ...part, output, status: "completed" }
}

function jsonlToolStatus(row: Record<string, unknown>): ToolStatus {
  const status = asString(row.status)?.toLowerCase()
  if (status === "error" || status === "failed") return "error"
  if (status === "cancelled" || status === "canceled") return "cancelled"
  if (status === "completed") return "completed"
  if (status === "pending") return "pending"
  if (row.output != null || row.result != null) return "completed"
  return "running"
}

async function summarize(file: string, now: number, mtime?: number): Promise<SessionSummary[]> {
  const infoMtime = mtime ?? (await stat(file).catch(() => undefined))?.mtimeMs
  if (infoMtime === undefined) return []
  const head = await readJsonlHead(file, 12)
  const firstUser = head.map(asRecord).find((row) => row?.role === "user")
  const id = path.basename(file, ".jsonl")
  const project = cursorProjectName(file)
  const text = textFromContent(asRecord(firstUser?.message)?.content)
  const createdAt = timestampMs(firstUser?.timestamp) ?? infoMtime
  const updatedAt = infoMtime
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
