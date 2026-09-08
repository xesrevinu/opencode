import { describe, expect, test } from "bun:test"
import { parseViewerArgs } from "../src/cli"

describe("parseViewerArgs", () => {
  test("defaults the TUI to live mode", () => {
    expect(parseViewerArgs([])).toEqual({ mode: "live" })
  })

  test("defaults JSON and session dumps to all history", () => {
    expect(parseViewerArgs(["--json"]).mode).toBe("all")
    expect(parseViewerArgs(["--session", "abc"]).session).toBe("abc")
    expect(parseViewerArgs(["-s", "abc"]).mode).toBe("all")
  })

  test("parses filters and keeps --live ahead of --all", () => {
    expect(parseViewerArgs(["--all", "--agent", "grok", "-q", "Metal"])).toEqual({
      mode: "all",
      agent: "grok",
      query: "Metal",
    })
    expect(parseViewerArgs(["--all", "--live"]).mode).toBe("live")
  })

  test("rejects unknown flags and missing values", () => {
    expect(() => parseViewerArgs(["--nope"])).toThrow("Unknown flag")
    expect(() => parseViewerArgs(["--agent"])).toThrow("requires a value")
  })
})
