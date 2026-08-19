import { Database } from "bun:sqlite"
import { existsSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { markLive } from "../live"
import type { SessionSummary, SessionTranscript, TranscriptPart } from "../model"
import { asNumber, asRecord, asString, formatJson, titleFromText } from "../text"

const listCache = new Map<string, { mtime: number; sessions: SessionSummary[] }>()

export function cursorStorePaths(cursorHome: string): string[] {
  const paths: string[] = []
  if (cursorHome.endsWith(".vscdb")) paths.push(cursorHome)
  else {
    paths.push(path.join(cursorHome, "state.vscdb"))
    paths.push(path.join(cursorHome, "User", "globalStorage", "state.vscdb"))
  }
  if (path.basename(cursorHome) === ".cursor") paths.push(defaultCursorStore(path.dirname(cursorHome)))
  return [...new Set(paths)].filter((file) => existsSync(file))
}

export function defaultCursorStore(root = os.homedir()) {
  if (process.platform === "darwin") {
    return path.join(root, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb")
  }
  if (process.platform === "win32") {
    return path.join(root, "AppData", "Roaming", "Cursor", "User", "globalStorage", "state.vscdb")
  }
  return path.join(root, ".config", "Cursor", "User", "globalStorage", "state.vscdb")
}

export function listCursorStore(cursorHome: string, now: number): SessionSummary[] {
  const seen = new Set<string>()
  const sessions: SessionSummary[] = []
  for (const file of cursorStorePaths(cursorHome)) {
    for (const session of listOneStore(file, now)) {
      if (seen.has(session.id)) continue
      seen.add(session.id)
      sessions.push(session)
    }
  }
  return sessions
}

export function loadCursorStore(summary: SessionSummary): SessionTranscript {
  const db = openStore(summary.sourcePath)
  if (!db) return { summary, parts: [] }
  try {
    const composer = readJson(db, `composerData:${summary.id}`)
    const headers = headerList(composer)
    const bubbles = loadBubbles(db, summary.id)
    const parts: TranscriptPart[] = []
    for (const header of headers) {
      const id = asString(header.bubbleId)
      if (!id) continue
      const bubble = bubbles.get(id) ?? {}
      const created = headerTime(header) ?? asNumber(bubble.createdAt)
      if (header.type === 1 || bubble.type === 1) {
        const text = userText(bubble, header)
        if (text) parts.push({ type: "user", id, text, timestamp: created })
        continue
      }
      const thinking = thinkingText(bubble)
      if (thinking) parts.push({ type: "reasoning", id: `${id}-think`, text: thinking, completed: true, timestamp: created })
      const text = asString(bubble.text)?.trim()
      if (text) parts.push({ type: "assistant", id, text, timestamp: created })
      const tool = asRecord(bubble.toolFormerData)
      if (!tool) continue
      const name = asString(tool.name) ?? asString(tool.tool)
      if (!name) continue
      const input = remapToolInput(toolInput(tool))
      parts.push({
        type: "tool",
        id: asString(tool.toolCallId) ?? toolCallId(header) ?? id,
        name,
        input: formatJson(input),
        output: toolOutput(name, tool),
        status: toolStatus(asString(tool.status)),
        timestamp: created,
        metadata: asRecord(tool.additionalData),
      })
    }
    return { summary, parts }
  } finally {
    db.close()
  }
}

function listOneStore(file: string, now: number): SessionSummary[] {
  const mtime = statSync(file).mtimeMs
  const cached = listCache.get(file)
  if (cached && cached.mtime === mtime) {
    return cached.sessions.map((session) => ({ ...session, live: markLive(session.updatedAt, now) }))
  }
  const db = openStore(file)
  if (!db) return []
  try {
    const rows = db.query("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as {
      key: string
      value: unknown
    }[]
    const sessions = rows.flatMap((row) => {
      const composer = parseJson(row.value)
      if (!composer) return []
      const id = row.key.slice("composerData:".length)
      const headers = headerList(composer)
      if (id === "empty-state-draft" || headers.length === 0) return []
      const createdAt = asNumber(composer.createdAt) ?? headerTime(headers[0]) ?? mtime
      const updatedAt = asNumber(composer.lastUpdatedAt) ?? headerTime(headers[headers.length - 1]) ?? createdAt
      const title = asString(composer.name)?.trim() || titleFromText(headerPreview(headers), id)
      return [
        {
          id,
          agent: "cursor" as const,
          title,
          cwd: composerCwd(composer),
          model: asString(asRecord(composer.modelConfig)?.modelName),
          createdAt,
          updatedAt,
          live: markLive(updatedAt, now),
          messageCount: headers.length,
          sourcePath: file,
        },
      ]
    })
    listCache.set(file, { mtime, sessions })
    return sessions
  } finally {
    db.close()
  }
}

function loadBubbles(db: Database, composerId: string) {
  const rows = db.query("SELECT key, value FROM cursorDiskKV WHERE key LIKE ?").all(`bubbleId:${composerId}:%`) as {
    key: string
    value: unknown
  }[]
  const bubbles = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const record = parseJson(row.value)
    if (!record) continue
    bubbles.set(row.key.slice(row.key.lastIndexOf(":") + 1), record)
  }
  return bubbles
}

function openStore(file: string) {
  try {
    return new Database(file, { readonly: true, create: false })
  } catch {
    return undefined
  }
}

function readJson(db: Database, key: string) {
  const row = db.query("SELECT value FROM cursorDiskKV WHERE key = ?").get(key) as { value: unknown } | null
  return row ? parseJson(row.value) : undefined
}

function parseJson(value: unknown) {
  const text = blobText(value)
  if (!text) return
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return
  }
}

function blobText(value: unknown) {
  if (typeof value === "string") return value
  if (value instanceof Uint8Array) return new TextDecoder().decode(value)
}

function headerList(composer?: Record<string, unknown>) {
  const headers = composer?.fullConversationHeadersOnly
  if (!Array.isArray(headers)) return []
  return headers.flatMap((item) => {
    const record = asRecord(item)
    return record ? [record] : []
  })
}

function headerTime(header?: Record<string, unknown>) {
  const created = header?.createdAt
  if (typeof created === "number") return created
  if (typeof created === "string") {
    const parsed = Date.parse(created)
    return Number.isNaN(parsed) ? undefined : parsed
  }
}

function headerPreview(headers: Record<string, unknown>[]) {
  for (const header of headers) {
    if (header.type !== 1) continue
    const grouping = asRecord(header.grouping)
    const preview = asString(grouping?.textPreview)
    if (preview) return preview
  }
  return ""
}

function toolCallId(header: Record<string, unknown>) {
  return asString(asRecord(header.grouping)?.toolCallId)
}

function composerCwd(composer: Record<string, unknown>) {
  const workspace = asRecord(composer.workspaceIdentifier)
  const uri = asRecord(workspace?.uri)
  const fromUri = asString(uri?.fsPath) ?? asString(uri?.path)
  if (fromUri) return fromUri
  if (typeof workspace?.uri === "string") return workspace.uri
  const repos = composer.trackedGitRepos
  if (!Array.isArray(repos)) return
  const repo = asRecord(repos[0])
  return asString(repo?.repoPath) ?? asString(repo?.path)
}

function userText(bubble: Record<string, unknown>, header: Record<string, unknown>) {
  const text = asString(bubble.text)?.trim()
  if (text) return text
  const rich = asString(asRecord(bubble.richText)?.text)?.trim()
  if (rich) return rich
  return asString(asRecord(header.grouping)?.textPreview)?.trim()
}

function thinkingText(bubble: Record<string, unknown>) {
  if (typeof bubble.thinking === "string") return bubble.thinking.trim()
  return asString(asRecord(bubble.thinking)?.text)?.trim()
}

function toolStatus(status?: string) {
  const normalized = status?.toLowerCase()
  if (normalized === "error" || normalized === "failed") return "error" as const
  if (normalized === "pending" || normalized === "running" || normalized === "loading") return "running" as const
  return "completed" as const
}

function toolInput(tool: Record<string, unknown>) {
  for (const raw of [tool.params, tool.rawArgs, tool.input]) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return flattenMcpInput(raw as Record<string, unknown>)
    if (typeof raw !== "string" || !raw.trim()) continue
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return flattenMcpInput(parsed as Record<string, unknown>)
    } catch {
      return { value: raw }
    }
  }
  return {}
}

function flattenMcpInput(input: Record<string, unknown>) {
  if (!Array.isArray(input.tools)) return { ...input }
  const first = asRecord(input.tools[0])
  if (!first) return { ...input }
  const parameters = first.parameters
  if (typeof parameters === "string") {
    try {
      const parsed = JSON.parse(parameters)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      return { value: parameters }
    }
  }
  return asRecord(parameters) ?? { ...input }
}

function remapToolInput(input: Record<string, unknown>) {
  const next = { ...input }
  if (!asString(next.path)) {
    const pathValue = asString(next.targetFile) ?? asString(next.effectiveUri) ?? asString(next.relativeWorkspacePath)
    if (pathValue) next.path = pathValue
  }
  if (!asString(next.pattern)) {
    const pattern = asString(next.globPattern)
    if (pattern) next.pattern = pattern
  }
  if (!asString(next.path) && asString(next.targetDirectory)) next.path = next.targetDirectory
  if (!asString(next.query) && asString(next.searchTerm)) next.query = next.searchTerm
  return next
}

function toolOutput(name: string, tool: Record<string, unknown>) {
  const result = parseResult(tool.result)
  if (!result) return
  if (typeof result === "string") return result
  if (name.includes("run_terminal") || name === "Shell") return asString(result.output) ?? asString(result.stdout)
  if (name.includes("read_file") || name === "Read") return asString(result.contents) ?? asString(result.content)
  if (name.includes("glob")) return globOutput(result)
  if (name === "web_fetch" || name === "WebFetch") return asString(result.markdown) ?? asString(result.content)
  if (name === "web_search" || name === "WebSearch") return webSearchOutput(result)
  const mcp = mcpOutput(result)
  if (mcp) return mcp
  return (
    asString(result.output) ??
    asString(result.text) ??
    asString(result.contents) ??
    asString(result.content) ??
    (result.error ? formatJson(result.error) : undefined)
  )
}

function globOutput(result: Record<string, unknown>) {
  const files = Array.isArray(result.files) ? result.files.flatMap(filePath) : []
  const directories = Array.isArray(result.directories) ? result.directories : []
  const nested = directories.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return typeof item === "string" ? [item] : []
    const listed = Array.isArray(record.files) ? record.files.flatMap(filePath) : []
    if (listed.length > 0) return listed
    return filePath(record.absPath ?? record.path ?? item)
  })
  const paths = [...files, ...nested]
  if (paths.length === 0) return
  return paths.join("\n")
}

function filePath(value: unknown) {
  if (typeof value === "string") return [value]
  const record = asRecord(value)
  const pathValue = asString(record?.relPath) ?? asString(record?.path) ?? asString(record?.absPath)
  return pathValue ? [pathValue] : []
}

function webSearchOutput(result: Record<string, unknown>) {
  const references = Array.isArray(result.references) ? result.references : []
  const lines = references.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return []
    const title = asString(record.title) ?? asString(record.name)
    const url = asString(record.url) ?? asString(record.link)
    if (title && url) return [`${title} ${url}`]
    return title || url ? [title ?? url ?? ""] : []
  })
  if (lines.length > 0) return lines.join("\n")
  return asString(result.output)
}

function mcpOutput(result: Record<string, unknown>) {
  const raw = result.result
  const parsed = typeof raw === "string" ? parseResult(raw) : asRecord(raw)
  if (!parsed || typeof parsed === "string") return typeof parsed === "string" ? parsed : undefined
  const content = parsed.content
  if (Array.isArray(content)) {
    const text = content
      .map((item) => (typeof item === "string" ? item : asString(asRecord(item)?.text) ?? ""))
      .filter(Boolean)
      .join("\n")
    if (text) return text
  }
  return asString(parsed.text)
}

function parseResult(value: unknown): string | Record<string, unknown> | undefined {
  if (value == null) return
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== "string") return
  const trimmed = value.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === "string") return parsed
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
    } catch {
      return trimmed
    }
  }
  return trimmed
}
