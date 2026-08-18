export const LIVE_WINDOW_MS = 3 * 60 * 1000

export function isRecentlyUpdated(updatedAt: number, now: number, window = LIVE_WINDOW_MS) {
  return now - updatedAt <= window
}

export function markLive(updatedAt: number, now: number, extra = false) {
  return extra || isRecentlyUpdated(updatedAt, now)
}
