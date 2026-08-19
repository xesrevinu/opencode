import { describe, expect, test } from "bun:test"
import path from "node:path"
import { readJsonlHead } from "../src/jsonl"
import { tempRoot, writeJsonl } from "./helpers"

describe("readJsonlHead", () => {
  test("stops after the requested lines without needing the rest of the file", async () => {
    const root = await tempRoot("jsonl-head")
    const file = path.join(root, "big.jsonl")
    const rows = Array.from({ length: 2000 }, (_, index) => ({
      role: index === 0 ? "user" : "assistant",
      message: { content: [{ type: "text", text: index === 0 ? "first user" : `pad-${index}-${"x".repeat(80)}` }] },
    }))
    await writeJsonl(file, rows)
    const head = await readJsonlHead(file, 2)
    expect(head).toHaveLength(2)
    expect(head[0]).toMatchObject({ role: "user" })
    const again = await readJsonlHead(file, 2)
    expect(again).toHaveLength(2)
  })
})
