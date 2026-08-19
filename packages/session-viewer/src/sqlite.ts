import { Database } from "bun:sqlite"
import { existsSync, statSync } from "node:fs"

export function openReadonlyDatabase(file: string) {
  try {
    const db = new Database(sqliteReadonlyUri(file), { readonly: true, create: false })
    db.run("PRAGMA query_only = ON")
    return db
  } catch {
    return undefined
  }
}

export function sqliteReadonlyUri(file: string) {
  return `file:${encodeURI(file.split("\\").join("/"))}?mode=ro`
}

export function storeStamp(file: string) {
  return [file, `${file}-wal`].map((path) => {
    if (!existsSync(path)) return "0"
    return String(statSync(path).mtimeMs)
  }).join(":")
}
