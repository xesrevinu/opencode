import { expect, test } from "bun:test"
import path from "node:path"
import { Global } from "@opencode-ai/util/global"
import { cliConfigPath, createCliConfigService } from "../src/tui/config"
import { defaultHomes } from "../src/homes"
import { tempRoot } from "./helpers"

test("cliConfigPath follows OPENCODE_CONFIG_DIR", () => {
  const previous = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = "/tmp/opencode-v2-config"
  try {
    expect(cliConfigPath()).toBe("/tmp/opencode-v2-config/cli.json")
  } finally {
    restoreEnv("OPENCODE_CONFIG_DIR", previous)
  }
})

test("cliConfigPath falls back to OpenCode's global config directory", () => {
  const previous = process.env.OPENCODE_CONFIG_DIR
  delete process.env.OPENCODE_CONFIG_DIR
  try {
    expect(cliConfigPath()).toBe(path.join(Global.Path.config, "cli.json"))
  } finally {
    restoreEnv("OPENCODE_CONFIG_DIR", previous)
  }
})

test("reads and updates OpenCode cli.json without dropping comments", async () => {
  const file = path.join(await tempRoot("cli-config"), "cli.json")
  await Bun.write(
    file,
    `{
  // keep this comment
  "theme": {
    "name": "opencode",
    "mode": "dark"
  }
}
`,
  )
  const service = createCliConfigService(file)
  expect(await service.get()).toEqual({ theme: { name: "opencode", mode: "dark" } })

  const next = await service.update((draft) => {
    draft.session = { ...draft.session, thinking: "show", tools: "show" }
  })
  expect(next).toEqual({
    theme: { name: "opencode", mode: "dark" },
    session: { thinking: "show", tools: "show" },
  })

  const text = await Bun.file(file).text()
  expect(text).toContain("// keep this comment")
  expect(text).toContain('"thinking": "show"')
  expect(text).toContain('"tools": "show"')
})

test("returns an empty config when cli.json is missing", async () => {
  const file = path.join(await tempRoot("cli-config-missing"), "cli.json")
  expect(await createCliConfigService(file).get()).toEqual({})
})

test("default OpenCode home is the global data directory", () => {
  expect(defaultHomes().opencode).toBe(Global.Path.data)
  expect(defaultHomes("/tmp/viewer-home").opencode).toBe("/tmp/viewer-home/.local/share/opencode")
})

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
