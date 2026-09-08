import { RGBA } from "@opentui/core"
import type { ResolvedTheme } from "@opencode/theme/tui"

// Fraction of theme panel colors kept when transparency is enabled. Panel and
// dialog backgrounds are alpha-blended inside the renderer's framebuffer
// against whatever content or backdrop sits beneath them, which produces the
// translucent overlay look. Keep this clearly below 1.0: the renderer's
// terminal output is binary (alpha == 0 emits the terminal default background,
// alpha > 0 emits an opaque RGB), so a high value here still reads as a solid
// block.
export const TRANSPARENT_BACKGROUND_ALPHA = 0.55

// The terminal-level background is different: the renderer's output layer only
// distinguishes alpha == 0 (emit "default background", letting the terminal
// emulator's own background show through) from alpha > 0 (emit an opaque RGB).
// There is no per-cell translucency at the terminal. So the base background
// must become fully transparent for the terminal's background to show through;
// its RGB is kept so it still serves as the blend backdrop for translucent
// panels above it.
export function applyBackgroundTransparency(theme: ResolvedTheme): ResolvedTheme {
  return {
    ...theme,
    background: {
      ...theme.background,
      default: transparentColor(theme.background.default),
      surface: applyAlpha(theme.background.surface),
      action: applyAlpha(theme.background.action),
      formfield: applyAlpha(theme.background.formfield),
      feedback: applyAlpha(theme.background.feedback),
    },
    contextual: {
      elevated: {
        ...theme.contextual.elevated,
        background: applyAlpha(theme.contextual.elevated.background),
      },
      overlay: {
        ...theme.contextual.overlay,
        background: applyAlpha(theme.contextual.overlay.background),
      },
    },
    diff: {
      ...theme.diff,
      background: {
        added: transparentColor(theme.diff.background.added),
        removed: transparentColor(theme.diff.background.removed),
        context: transparentColor(theme.diff.background.context),
      },
      lineNumber: {
        ...theme.diff.lineNumber,
        background: {
          added: transparentColor(theme.diff.lineNumber.background.added),
          removed: transparentColor(theme.diff.lineNumber.background.removed),
        },
      },
    },
  }
}

// Text, syntax, and border colors stay fully opaque so content remains readable.
function applyAlpha<T>(value: T): T {
  if (value instanceof RGBA) {
    return RGBA.fromInts(
      Math.round(value.r * 255),
      Math.round(value.g * 255),
      Math.round(value.b * 255),
      Math.round(value.a * 255 * TRANSPARENT_BACKGROUND_ALPHA),
    ) as T
  }
  if (Array.isArray(value)) return value.map((item) => applyAlpha(item)) as T
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, applyAlpha(item)])) as T
  }
  return value
}

function transparentColor(color: RGBA) {
  return RGBA.fromInts(Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255), 0)
}
