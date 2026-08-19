import { Database } from "bun:sqlite"
import { noteOpenSqlite, storeStamp } from "./list-cache"

export { storeStamp }

export function openReadonlyDatabase(file: string) {
  noteOpenSqlite(file)
  try {
    const db = new Database(sqliteReadonlyUri(file), { readonly: true, create: false })
    db.run("PRAGMA query_only = ON")
    return db
  } catch {
    return undefined
  }
}

export function sqliteReadonlyUri(file: string) {
  const normalized = file.split("\\").join("/")
  return `file:${encodeURI(normalized).replaceAll("?", "%3F").replaceAll("#", "%23")}?mode=ro`
}
