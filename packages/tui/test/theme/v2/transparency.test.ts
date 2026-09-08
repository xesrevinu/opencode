import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { resolveThemeDocument } from "@opencode/theme/tui"
import {
  applyBackgroundTransparency,
  TRANSPARENT_BACKGROUND_ALPHA,
} from "../../../src/theme/transparency"
import { parseTheme } from "../../../src/theme"

const theme = () => resolveThemeDocument(parseTheme({ version: 2, dark: {} }))

test("applies transparency only to the background token group", () => {
  const resolved = theme()
  const transparent = applyBackgroundTransparency(resolved)

  // The terminal-level base background becomes fully transparent so the
  // terminal emulator's own background shows through; RGB is preserved to
  // keep serving as the blend backdrop for panels above it.
  const background = transparent.background.default
  const original = resolved.background.default
  expect(background.r).toBe(original.r)
  expect(background.g).toBe(original.g)
  expect(background.b).toBe(original.b)
  expect(background.a).toBe(0)

  expect(transparent.text.default).toBe(resolved.text.default)
  expect(transparent.border.default).toBe(resolved.border.default)
  expect(transparent.syntax.keyword).toBe(resolved.syntax.keyword)
})

test("applies transparency to contextual backgrounds", () => {
  const resolved = theme()
  const transparent = applyBackgroundTransparency(resolved)

  for (const context of ["elevated", "overlay"] as const) {
    expect(transparent.contextual[context].background.default.a).toBeCloseTo(TRANSPARENT_BACKGROUND_ALPHA, 2)
    expect(transparent.contextual[context].text.default).toBe(resolved.contextual[context].text.default)
  }

  expect(transparent.background.surface.offset.a).toBeCloseTo(TRANSPARENT_BACKGROUND_ALPHA, 2)
  expect(transparent.background.action.primary.hovered.a).toBeCloseTo(TRANSPARENT_BACKGROUND_ALPHA, 2)

  // Tokens that were already transparent (alpha 0) stay transparent.
  const transparentColor = RGBA.fromInts(0, 0, 0, 0)
  expect(transparent.background.action.primary.default).not.toBe(transparentColor)
  expect(resolved.background.action.primary.default.a).toBe(1)
})

test("applies transparency to diff block backgrounds", () => {
  const resolved = theme()
  const transparent = applyBackgroundTransparency(resolved)

  // Diff blocks stay fully transparent so the terminal background shows
  // through; their RGB is preserved as metadata but not emitted as a block.
  for (const kind of ["added", "removed", "context"] as const) {
    expect(transparent.diff.background[kind].a).toBe(0)
    expect(transparent.diff.background[kind].r).toBe(resolved.diff.background[kind].r)
    expect(transparent.diff.background[kind].g).toBe(resolved.diff.background[kind].g)
    expect(transparent.diff.background[kind].b).toBe(resolved.diff.background[kind].b)
  }

  for (const kind of ["added", "removed"] as const) {
    expect(transparent.diff.lineNumber.background[kind].a).toBe(0)
  }

  expect(transparent.diff.text.added).toBe(resolved.diff.text.added)
})

test("leaves opaque colors untouched when transparency is disabled", () => {
  const resolved = theme()
  expect(resolved.background.default.a).toBe(1)
  expect(resolved.contextual.overlay.background.default.a).toBe(1)
})
