import type { SessionInboxEnqueued } from "@opencode/client"
import { createEffect, on, onCleanup, type Accessor } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useConfig } from "../../config"
import { useData } from "../../context/data"
import { useClient } from "../../context/client"
import {
  append,
  completePrevious,
  hasPart,
  partitionPending,
  reduceSessionRows,
  type AppendPart,
  type PartRef,
  type SessionRow,
} from "./rows-reduce"

export {
  backgroundToolRowIndex,
  cacheReuseDrop,
  hasPart,
  messageBoundaryIDs,
  partitionPending,
  reduceSessionRows,
  resolvePart,
  sessionRowID,
  turnDuration,
  turnTokensPerSecond,
} from "./rows-reduce"
export type { BackgroundToolTarget, CacheUsage, PartRef, SessionRow } from "./rows-reduce"

export function createSessionRows(sessionID: Accessor<string>, onSynced?: (sessionID: string) => void) {
  const data = useData()
  const client = useClient()
  const config = useConfig()
  const [rows, setRows] = createStore<SessionRow[]>([])
  const revertBoundary = () => data.session.get(sessionID())?.revert?.messageID
  const turnTokens = () => Boolean(config.data.debug?.turn_tokens)

  function reduce() {
    const messages = data.session.message.list(sessionID())
    const inputs = new Set(data.session.input.list(sessionID()))
    const pending = data.session.pending.list(sessionID())
    const queued = new Set(
      pending.flatMap((item) => (item.type === "user" && item.delivery === "queue" ? [item.id] : [])),
    )
    const visible = queued.size === 0 ? messages : messages.filter((message) => !queued.has(message.id))
    const boundary = revertBoundary()
    const rows = reduceSessionRows(
      boundary ? visible.filter((message) => message.id < boundary) : visible,
      inputs,
      turnTokens(),
    )
    partitionPending(rows, pendingPermissions())
    const position = rows.findIndex((row) => row.type === "message" && inputs.has(row.messageID))
    rows.splice(
      position === -1 ? rows.length : position,
      0,
      ...pending
        .filter((item) => item.type === "compaction")
        .map((item): SessionRow => ({ type: "compaction-queued", inboxID: item.id })),
    )
    return rows
  }

  function pendingPermissions() {
    return new Set(
      (data.session.permission.list(sessionID()) ?? []).flatMap((request) =>
        request.source?.type === "tool" ? [request.source.id] : [],
      ),
    )
  }

  createEffect(() => {
    const pending = pendingPermissions()
    setRows(
      produce((draft) => {
        partitionPending(draft, pending)
      }),
    )
  })

  createEffect(
    on([sessionID, () => client.connection.status()], ([id, status]) => {
      if (status !== "connected") return
      setRows(reconcile(reduce()))
      void data.session.pending.sync(id).catch(() => undefined)
      void data.session.message.sync(id).then(
        () => {
          if (sessionID() !== id) return
          setRows(reconcile(reduce()))
          onSynced?.(id)
        },
        () => undefined,
      )
    }),
  )

  // Re-reduce when the revert boundary changes (stage/clear/commit). These reactions defer
  // their first run: the mount effect above has already reduced the same state.
  createEffect(
    on(
      revertBoundary,
      () => {
        setRows(reconcile(reduce()))
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () =>
        data.session.pending.list(sessionID()).flatMap((item) => {
          if (item.type === "compaction") return [`${item.id}:compaction`]
          if (item.type === "user" && item.delivery === "queue") return [`${item.id}:queue`]
          return []
        }),
      () => setRows(reconcile(reduce())),
      { defer: true },
    ),
  )

  createEffect(
    on(
      () =>
        data.session.message.list(sessionID()).flatMap((message) =>
          message.type === "user" || message.type === "synthetic"
            ? [
                {
                  id: message.id,
                  created: message.time.created,
                  input: data.session.input.has(sessionID(), message.id),
                },
              ]
            : message.type === "compaction"
              ? [
                  {
                    id: message.id,
                    created: message.time.created,
                  },
                ]
              : [],
        ),
      () => setRows(reconcile(reduce())),
      { defer: true },
    ),
  )

  createEffect(on(turnTokens, () => setRows(reconcile(reduce())), { defer: true }))

  const appendMessage = (messageID: string) =>
    setRows(
      produce((draft) => {
        if (draft.some((row) => row.type === "message" && row.messageID === messageID)) return
        const pending = isPending(messageID)
        const message = data.session.message.get(sessionID(), messageID)
        const index =
          message?.type === "compaction" && pending ? queuedStart(draft) : pending ? draft.length : queuedStart(draft)
        if (!pending) completePrevious(draft, index)
        draft.splice(index, 0, { type: "message", messageID })
      }),
    )

  const appendPart = (ref: PartRef, part: AppendPart) =>
    setRows(
      produce((draft) => {
        if (hasPart(draft, ref)) return
        append(draft, ref, part, queuedStart(draft))
      }),
    )

  const appendFooter = (messageID: string) =>
    setRows(
      produce((draft) => {
        if (draft.some((row) => row.type === "assistant-footer" && row.messageID === messageID)) return
        const index = queuedStart(draft)
        completePrevious(draft, index)
        draft.splice(index, 0, { type: "assistant-footer", messageID })
      }),
    )

  const removeFooter = (messageID: string) =>
    setRows(
      produce((draft) => {
        const index = draft.findIndex((row) => row.type === "assistant-footer" && row.messageID === messageID)
        if (index !== -1) draft.splice(index, 1)
      }),
    )

  const isPending = (messageID: string) => {
    const message = data.session.message.get(sessionID(), messageID)
    if (message?.type === "user" || message?.type === "synthetic") return data.session.input.has(sessionID(), messageID)
    return message?.type === "compaction" && message.status === "running"
  }

  const queuedStart = (rows: SessionRow[]) => {
    const index = rows.findIndex(
      (row) => row.type === "compaction-queued" || (row.type === "message" && isPending(row.messageID)),
    )
    return index === -1 ? rows.length : index
  }

  const message = (event: { id: string; data: { sessionID: string } }) => {
    if (event.data.sessionID === sessionID()) appendMessage(event.id.replace(/^evt_/, "msg_"))
  }
  const input = (event: SessionInboxEnqueued) => {
    if (
      event.data.sessionID === sessionID() &&
      (event.data.item.type === "user" ||
        (event.data.item.type === "synthetic" && event.data.item.payload.description?.trim()))
    )
      appendMessage(event.data.inboxID)
  }
  const subscriptions = [
    data.on("session.inbox.enqueued", input),
    data.on("session.compaction.started", (event) => {
      if (event.data.sessionID === sessionID()) appendMessage(event.data.inputID ?? event.id.replace(/^evt_/, "msg_"))
    }),
    data.on("session.instructions.updated", message),
    data.on("session.synthetic", (event) => {
      if (event.data.sessionID === sessionID() && event.data.description?.trim())
        appendMessage(event.id.replace(/^evt_/, "msg_"))
    }),
    data.on("session.shell.started", message),
    data.on("session.agent.selected", message),
    data.on("session.model.selected", message),
    data.on("session.text.delta", (event) => {
      if (event.data.sessionID === sessionID() && event.data.delta.trim())
        appendPart({ messageID: event.data.assistantMessageID, partID: `text:${event.data.ordinal}` }, { type: "text" })
    }),
    data.on("session.text.ended", (event) => {
      if (event.data.sessionID === sessionID() && event.data.text.trim())
        appendPart({ messageID: event.data.assistantMessageID, partID: `text:${event.data.ordinal}` }, { type: "text" })
    }),
    data.on("session.reasoning.delta", (event) => {
      if (event.data.sessionID === sessionID() && event.data.delta.trim())
        appendPart(
          { messageID: event.data.assistantMessageID, partID: `reasoning:${event.data.ordinal}` },
          { type: "reasoning" },
        )
    }),
    data.on("session.reasoning.ended", (event) => {
      if (event.data.sessionID === sessionID() && event.data.text.trim())
        appendPart(
          { messageID: event.data.assistantMessageID, partID: `reasoning:${event.data.ordinal}` },
          { type: "reasoning" },
        )
    }),
    data.on("session.tool.input.started", (event) => {
      if (event.data.sessionID === sessionID())
        appendPart(
          { messageID: event.data.assistantMessageID, partID: event.data.id },
          { type: "tool", name: event.data.name },
        )
    }),
    data.on("session.retry.scheduled", (event) => {
      if (event.data.sessionID === sessionID()) appendFooter(event.data.assistantMessageID)
    }),
    data.on("session.step.started", (event) => {
      if (event.data.sessionID === sessionID()) removeFooter(event.data.assistantMessageID)
    }),
    data.on("session.step.ended", (event) => {
      if (event.data.sessionID !== sessionID() || ["tool-calls", "unknown"].includes(event.data.finish)) return
      appendFooter(event.data.assistantMessageID)
      if (turnTokens()) setRows(reconcile(reduce()))
    }),
    data.on("session.step.failed", (event) => {
      if (event.data.sessionID !== sessionID()) return
      appendFooter(event.data.assistantMessageID)
      if (turnTokens()) setRows(reconcile(reduce()))
    }),
  ]
  onCleanup(() => subscriptions.forEach((unsubscribe) => unsubscribe()))

  return rows
}
