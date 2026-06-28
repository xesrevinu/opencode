/** @jsxImportSource @opentui/solid */
import { EventEmitter } from "node:events"
import { CliRenderEvents } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createEffect, Show } from "solid-js"
import { TuiConfigProvider } from "../src/config"
import { KVProvider } from "../src/context/kv"
import { ThemeProvider, useTheme } from "../src/context/theme"
import { TestTuiContexts } from "./fixture/tui-environment"
import { tmpdir } from "./fixture/fixture"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountTheme(input: { root: string; initialMode: "dark" | "light"; seen: string[] }) {
  const state = path.join(input.root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), JSON.stringify({ theme: "tokyonight" }))

  const source = {
    async discover() {
      return {}
    },
  }

  function Capture() {
    const theme = useTheme()
    createEffect(() => input.seen.push(theme.mode()))
    return <box />
  }

  function Harness() {
    const renderer = useRenderer() as unknown as EventEmitter & { themeMode: "dark" | "light" | null }
    return (
      <TestTuiContexts
        directory={input.root}
        paths={{
          home: input.root,
          state,
          worktree: input.root,
        }}
      >
        <TuiConfigProvider config={createTuiResolvedConfig({ theme: "tokyonight" })}>
          <KVProvider>
            <ThemeProvider mode={input.initialMode} source={source}>
              <Show when={true}>
                <Capture />
              </Show>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />)
  return {
    renderer: app.renderer as unknown as EventEmitter & { stdin: EventEmitter },
    cleanup() {
      app.renderer.destroy()
    },
  }
}

test("theme provider follows OpenTUI theme_mode events", async () => {
  await using tmp = await tmpdir()
  const seen: string[] = []
  const app = await mountTheme({ root: tmp.path, initialMode: "dark", seen })

  try {
    await wait(() => seen.includes("dark"))
    app.renderer.emit(CliRenderEvents.THEME_MODE, "light")

    await wait(() => seen.includes("light"))
    expect(seen.at(-1)).toBe("light")
  } finally {
    app.cleanup()
  }
})

test("theme provider follows raw Mode 2031 notifications", async () => {
  await using tmp = await tmpdir()
  const seen: string[] = []
  const app = await mountTheme({ root: tmp.path, initialMode: "dark", seen })

  try {
    await wait(() => seen.includes("dark"))
    app.renderer.stdin.emit("data", Buffer.from("\x1b[?997;2n"))

    await wait(() => seen.includes("light"))
    expect(seen.at(-1)).toBe("light")
  } finally {
    app.cleanup()
  }
})
