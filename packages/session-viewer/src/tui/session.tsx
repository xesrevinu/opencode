import { Show, createEffect } from "solid-js"
import { type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { SessionMessageList } from "@opencode-ai/tui/session-message-list"
import { useTheme } from "@opencode-ai/tui/context/theme"
import { useDialog } from "@opencode-ai/tui/ui/dialog"
import type { SessionTranscript } from "../model"
import { AGENT_LABEL } from "../model"
import { toOpenCodeMessages } from "../opencode-view"
import { formatRelative, shortSessionId } from "../format"
import os from "node:os"

export function SessionView(props: { transcript?: SessionTranscript; now: number }) {
  const theme = useTheme()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const pad = () => (dimensions().width < 44 ? 1 : 2)
  let scroll: ScrollBoxRenderable | undefined

  createEffect(() => {
    props.transcript
    queueMicrotask(() => {
      if (scroll) scroll.scrollTo(scroll.scrollHeight)
    })
  })

  const scrollBy = (delta: number) => {
    if (!scroll) return
    if (delta < 0) scroll.stickyScroll = false
    scroll.scrollBy(delta)
  }

  useKeyboard((event) => {
    if (dialog.stack.length) return
    if (!scroll) return
    const page = Math.max(1, scroll.viewport.height - 1)
    const block = Math.max(10, Math.floor(scroll.viewport.height / 2))
    const shift = event.shift || event.name === "J" || event.name === "K"
    if (event.name === "j" || event.name === "J" || event.name === "down") {
      scrollBy(shift ? block : 1)
      event.preventDefault()
      return
    }
    if (event.name === "k" || event.name === "K" || event.name === "up") {
      scrollBy(shift ? -block : -1)
      event.preventDefault()
      return
    }
    if (event.name === "pagedown") {
      scrollBy(page)
      event.preventDefault()
      return
    }
    if (event.name === "pageup") {
      scrollBy(-page)
      event.preventDefault()
    }
  })

  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={theme.background.default}
      paddingTop={pad()}
      paddingLeft={pad()}
      paddingRight={pad()}
    >
      <Show
        when={props.transcript}
        fallback={
          <box paddingTop={1}>
            <text fg={theme.text.subdued}>Loading session…</text>
          </box>
        }
      >
        {(transcript) => (
          <>
            <scrollbox
              ref={(element: ScrollBoxRenderable) => (scroll = element)}
              flexGrow={1}
              flexShrink={1}
              minHeight={0}
              stickyScroll
              stickyStart="bottom"
            >
              <SessionMessageList
                messages={toOpenCodeMessages(transcript())}
                cwd={transcript().summary.cwd}
                home={os.homedir()}
                keyboard={false}
                footer={false}
              />
            </scrollbox>
            <box height={1} marginTop={1} flexShrink={0} flexDirection="row">
              <text fg={theme.text.subdued} wrapMode="none" truncate flexShrink={1} minWidth={12}>
                esc home  s settings  j/k  J/K block
              </text>
              <box flexGrow={1} />
              <text fg={theme.text.action.primary.default} wrapMode="none">
                {AGENT_LABEL[transcript().summary.agent]}
              </text>
              <text fg={theme.text.subdued} wrapMode="none">
                {"  "}
                {shortSessionId(transcript().summary.id)}
              </text>
              <Show when={transcript().summary.live}>
                <text fg={theme.text.feedback.success.default}>  live</text>
              </Show>
              <text fg={theme.text.subdued} wrapMode="none">
                {"  "}
                {formatRelative(transcript().summary.updatedAt, props.now)}
              </text>
            </box>
          </>
        )}
      </Show>
    </box>
  )
}
