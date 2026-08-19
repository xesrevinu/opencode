import { open, readdir, stat } from "node:fs/promises"
import path from "node:path"

const headCache = new Map<string, { mtime: number; size: number; rows: unknown[] }>()

export function parseJsonl(text: string) {
  return text.split("\n").flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed) return []
    try {
      return [JSON.parse(trimmed) as unknown]
    } catch {
      return []
    }
  })
}

export async function readJsonl(file: string) {
  const text = await Bun.file(file)
    .text()
    .catch(() => "")
  return parseJsonl(text)
}

export async function readJsonlHead(file: string, maxLines = 24) {
  const info = await stat(file).catch(() => undefined)
  if (!info) return []
  const key = `${file}:${maxLines}`
  const cached = headCache.get(key)
  if (cached && cached.mtime === info.mtimeMs && cached.size === info.size) return cached.rows
  const rows = await readBoundedHead(file, maxLines)
  headCache.set(key, { mtime: info.mtimeMs, size: info.size, rows })
  return rows
}

async function readBoundedHead(file: string, maxLines: number) {
  const handle = await open(file, "r").catch(() => undefined)
  if (!handle) return []
  try {
    const rows: unknown[] = []
    let leftover = ""
    const buf = Buffer.alloc(64 * 1024)
    while (rows.length < maxLines) {
      const { bytesRead } = await handle.read(buf, 0, buf.length)
      if (bytesRead === 0) break
      leftover += buf.toString("utf8", 0, bytesRead)
      const lines = leftover.split("\n")
      leftover = lines.pop() ?? ""
      for (const line of lines) {
        const parsed = parseLine(line)
        if (parsed === undefined) continue
        rows.push(parsed)
        if (rows.length >= maxLines) return rows
      }
    }
    if (rows.length < maxLines) {
      const parsed = parseLine(leftover)
      if (parsed !== undefined) rows.push(parsed)
    }
    return rows
  } finally {
    await handle.close()
  }
}

function parseLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return
  }
}

export async function walkFiles(root: string, match: (name: string, full: string) => boolean) {
  const out: string[] = []
  async function visit(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(full)
        continue
      }
      if (entry.isFile() && match(entry.name, full)) out.push(full)
    }
  }
  await visit(root)
  return out
}
