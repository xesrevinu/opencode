import { Show } from "solid-js"
import { SessionMessageList } from "@opencode-ai/tui/session-message-list"
import type { SessionTranscript } from "../model"
import { AGENT_LABEL } from "../model"
import { toOpenCodeMessages } from "../opencode-view"
import { formatWhen, shortPath } from "../format"
import { theme } from "./theme"
import os from "node:os"

export function SessionView(props: { transcript?: SessionTranscript; now: number }) {
  return (
    <box flexGrow={1} flexDirection="column">
      <Show
        when={props.transcript}
        fallback={
          <box padding={1}>
            <text fg={theme.muted}>Loading session…</text>
          </box>
        }
      >
        {(transcript) => (
          <>
            <box paddingLeft={1} paddingRight={1} height={1}>
              <text fg={theme.accent}>{AGENT_LABEL[transcript().summary.agent]}</text>
              <text fg={theme.text}>  {transcript().summary.title}</text>
              <Show when={transcript().summary.live}>
                <text fg={theme.live}>  live</text>
              </Show>
            </box>
            <box paddingLeft={1} height={1}>
              <text fg={theme.muted}>
                {shortPath(transcript().summary.cwd)}  {transcript().summary.model ?? ""}  {formatWhen(transcript().summary.updatedAt)}
              </text>
            </box>
            <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
              <SessionMessageList
                messages={toOpenCodeMessages(transcript())}
                cwd={transcript().summary.cwd}
                home={os.homedir()}
              />
            </scrollbox>
            <box height={1} paddingLeft={1}>
              <text fg={theme.dim}>esc home · j/k tools · enter expand · read-only</text>
            </box>
          </>
        )}
      </Show>
    </box>
  )
}
