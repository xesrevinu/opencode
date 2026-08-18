#!/usr/bin/env bun

import { Effect } from "effect"
import { parseViewerArgs, runViewerCli } from "./cli"

const HELP = `session-viewer — read-only TUI for local coding-agent sessions

Usage:
  session-viewer
  session-viewer --all
  session-viewer --json [--agent <name>] [--query <text>]
  session-viewer --session <id>

Flags:
  --live            Show only live sessions (default for the TUI)
  --all             Show live and historical sessions
  --agent <name>    Filter: opencode, cursor, codex, pi, grok, claude
  --query, -q       Filter by title, path, or id
  --json            Print the catalog as JSON
  --session, -s     Print one transcript as JSON
  --home <dir>      Override the user home used to discover stores
  --help, -h        Show this help

This binary does not start OpenCode or write agent state.
`

const program = Effect.gen(function* () {
  const options = parseViewerArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(HELP)
    return
  }
  yield* Effect.tryPromise({
    try: () => runViewerCli(options),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
})

Effect.runPromise(program).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exitCode = 1
})
