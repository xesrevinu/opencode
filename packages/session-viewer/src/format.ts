export function formatRelative(ms: number, now: number) {
  const delta = Math.max(0, now - ms)
  if (delta < 60_000) return "just now"
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return `${Math.floor(delta / 86_400_000)}d ago`
}

export function formatWhen(ms: number) {
  return new Date(ms).toLocaleString()
}

export function shortPath(value: string | undefined, home = process.env.HOME) {
  if (!value) return ""
  if (home && value.startsWith(home)) return `~${value.slice(home.length)}`
  return value
}

export function shortSessionId(id: string) {
  if (id.length <= 18) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}
