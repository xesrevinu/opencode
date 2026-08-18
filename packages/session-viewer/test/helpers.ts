import { mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export async function tempRoot(name: string) {
  const root = path.join(os.tmpdir(), `session-viewer-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(root, { recursive: true })
  return root
}

export async function writeJsonl(file: string, rows: unknown[]) {
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n")
}

export async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify(value, null, 2))
}
