import path from "node:path"
import { Global } from "@opencode/util/global"
import { AGENTS, type AgentHomes, type AgentKind } from "./model"

export function defaultHomes(root = Global.Path.home): Required<AgentHomes> {
  return {
    opencode:
      path.resolve(root) === path.resolve(Global.Path.home)
        ? Global.Path.data
        : path.join(root, ".local", "share", "opencode"),
    cursor: path.join(root, ".cursor"),
    codex: path.join(root, ".codex"),
    pi: path.join(root, ".pi"),
    grok: path.join(root, ".grok"),
    claude: path.join(root, ".claude"),
  }
}

export function resolveHomes(homes?: AgentHomes, root?: string): Required<AgentHomes> {
  const defaults = defaultHomes(root)
  return {
    opencode: homes?.opencode ?? defaults.opencode,
    cursor: homes?.cursor ?? defaults.cursor,
    codex: homes?.codex ?? defaults.codex,
    pi: homes?.pi ?? defaults.pi,
    grok: homes?.grok ?? defaults.grok,
    claude: homes?.claude ?? defaults.claude,
  }
}

export function parseAgent(value: string | undefined): AgentKind | undefined {
  if (!value) return
  const normalized = value.trim().toLowerCase()
  return AGENTS.find((agent) => agent === normalized)
}
