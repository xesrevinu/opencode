export const AGENTS = ["opencode", "cursor", "codex", "pi", "grok", "claude"] as const
export type AgentKind = (typeof AGENTS)[number]

export const AGENT_LABEL: Record<AgentKind, string> = {
  opencode: "OpenCode",
  cursor: "Cursor",
  codex: "Codex",
  pi: "PI",
  grok: "Grok",
  claude: "Claude",
}

export type FilterMode = "live" | "history" | "all"

export type SessionSummary = {
  id: string
  agent: AgentKind
  title: string
  cwd?: string
  model?: string
  createdAt: number
  updatedAt: number
  live: boolean
  messageCount?: number
  sourcePath: string
}

export type ToolStatus = "pending" | "running" | "completed" | "error"

export type TranscriptPart =
  | { type: "user"; id: string; text: string; timestamp?: number }
  | { type: "assistant"; id: string; text: string; timestamp?: number }
  | { type: "reasoning"; id: string; text: string; completed: boolean; timestamp?: number }
  | {
      type: "tool"
      id: string
      name: string
      input: string
      output?: string
      status: ToolStatus
      timestamp?: number
      metadata?: Record<string, unknown>
    }
  | { type: "system"; id: string; text: string; timestamp?: number }

export type SessionTranscript = {
  summary: SessionSummary
  parts: TranscriptPart[]
}

export type SessionFilter = {
  mode: FilterMode
  agent?: AgentKind
  query?: string
}

export type AgentGroup = {
  agent: AgentKind
  liveCount: number
  totalCount: number
  sessions: SessionSummary[]
}

export type Catalog = {
  groups: AgentGroup[]
  sessions: SessionSummary[]
  liveCount: number
  totalCount: number
}

export type AgentHomes = Partial<Record<AgentKind, string>>
