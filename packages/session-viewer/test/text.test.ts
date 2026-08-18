import { describe, expect, test } from "bun:test"
import { collapseToolOutput, cwdFromEncodedName, textFromContent, titleFromText } from "../src/text"
import { formatRelative } from "../src/format"
import { markLive } from "../src/live"

describe("text helpers", () => {
  test("extracts text from mixed content arrays", () => {
    expect(textFromContent([{ type: "input_text", text: "hello" }, { type: "text", text: "world" }])).toBe("hello\nworld")
  })

  test("strips tags when building titles", () => {
    expect(titleFromText("<user_query>audit native apis</user_query>", "fallback")).toBe("audit native apis")
  })

  test("decodes agent project directory names", () => {
    expect(cwdFromEncodedName("%2FUsers%2Fkee%2Frepo")).toBe("/Users/kee/repo")
    expect(cwdFromEncodedName("-Users-kee-repo")).toBe("/Users/kee/repo")
  })

  test("collapses long tool output the same way the TUI does", () => {
    const result = collapseToolOutput("a\n".repeat(20), 3, 400)
    expect(result.overflow).toBe(true)
    expect(result.output.split("\n")).toHaveLength(3)
  })

  test("marks recent or explicitly active sessions live", () => {
    expect(markLive(1000, 1000 + 30_000)).toBe(true)
    expect(markLive(1000, 1000 + 10 * 60_000)).toBe(false)
    expect(markLive(1000, 1000 + 10 * 60_000, true)).toBe(true)
    expect(formatRelative(1000, 1000 + 5 * 60_000)).toBe("5m ago")
  })
})
