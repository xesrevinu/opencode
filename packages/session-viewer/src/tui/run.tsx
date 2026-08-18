import { render } from "@opentui/solid"
import type { AgentHomes, SessionFilter } from "../model"
import { resolveHomes } from "../homes"
import { ViewerApp } from "./app"

export async function runSessionViewer(input: { homes?: AgentHomes; filter: SessionFilter }) {
  await render(() => <ViewerApp homes={resolveHomes(input.homes)} initialFilter={input.filter} />, {
    exitOnCtrlC: true,
    targetFps: 30,
    useMouse: true,
    autoFocus: true,
  })
}
