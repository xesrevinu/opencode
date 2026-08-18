import { readdir } from "node:fs/promises"
import path from "node:path"

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
  const text = await Bun.file(file)
    .text()
    .catch(() => "")
  const rows: unknown[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      rows.push(JSON.parse(trimmed))
    } catch {
      continue
    }
    if (rows.length >= maxLines) break
  }
  return rows
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
