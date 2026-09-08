import { expect, test } from "bun:test"
import { App } from "@opencode/core/app"

test("masks the user agent as codex", () => {
  expect(App.useragent(App.make({ name: "sdk", version: "1.2.3", channel: "beta" }))).toBe("codex")
})

test("marks local builds as codex local", () => {
  expect(App.useragent(App.make())).toBe("codex local")
})