export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return
  return value
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return
  return value
}

export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((item) => {
      if (typeof item === "string") return item
      const record = asRecord(item)
      if (!record) return ""
      if (typeof record.text === "string") return record.text
      if (typeof record.input_text === "string") return record.input_text
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

export function titleFromText(text: string, fallback: string) {
  const cleaned = text
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return fallback
  if (cleaned.length <= 80) return cleaned
  return `${cleaned.slice(0, 77)}…`
}

export function timestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return value
    if (value > 1e9) return value * 1000
    return value
  }
  if (typeof value !== "string" || value.length === 0) return
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return
  return parsed
}

export function formatJson(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  if (value === undefined) return ""
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function collapseToolOutput(output: string, maxLines = 8, maxChars = 400) {
  const lines = output.split("\n")
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) {
    return { output, overflow: false }
  }
  const visible = lines.slice(0, maxLines)
  if (lines.length > maxLines && visible.length > 0) visible[visible.length - 1] += "…"
  const preview = visible.join("\n")
  if (Array.from(preview).length > maxChars) {
    return {
      output: `${Array.from(preview).slice(0, Math.max(0, maxChars - 1)).join("")}…`,
      overflow: true,
    }
  }
  return { output: preview, overflow: true }
}

export function cwdFromEncodedName(name: string) {
  try {
    const decoded = decodeURIComponent(name)
    if (decoded.startsWith("/")) return decoded
  } catch {
    // keep falling through to the dash-encoded form used by Claude/PI
  }
  if (name.startsWith("-")) return `/${name.slice(1).replace(/-/g, "/")}`
}

export function nextId(prefix: string, index: number) {
  return `${prefix}-${index}`
}
