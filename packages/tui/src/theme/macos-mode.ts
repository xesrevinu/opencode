// macOS does not expose a generic terminal notification for the OS appearance
// changing. Some terminals forward it, but tmux and several common terminals
// do not, so the TUI watches AppleInterfaceThemeChangedNotification directly
// as a fallback when the configured mode is "system".
export function startMacOSThemeModeWatcher(
  onMode: (mode: "dark" | "light") => void,
): (() => void) | undefined {
  if (process.platform !== "darwin") return
  if (process.env.OPENCODE_DISABLE_MACOS_THEME_WATCHER === "1") return

  const proc = Bun.spawn(["/usr/bin/swift", "-e", MACOS_THEME_MODE_SWIFT], {
    env: macOSSwiftEnv(),
    stdout: "pipe",
    stderr: "ignore",
  })
  let active = true
  let buffer = ""
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()

  void (async () => {
    while (active) {
      const next = await reader.read().catch(() => undefined)
      if (!next || next.done) return
      buffer += decoder.decode(next.value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const mode = line.trim()
        if (mode === "dark" || mode === "light") onMode(mode)
      }
    }
  })()

  return () => {
    active = false
    reader.cancel().catch(() => {})
    proc.kill()
  }
}

function macOSSwiftEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => {
      if (key === "SDKROOT" || key === "DEVELOPER_DIR" || key === "TOOLCHAINS") return false
      if (key === "CPATH" || key === "C_INCLUDE_PATH" || key === "CPLUS_INCLUDE_PATH" || key === "LIBRARY_PATH")
        return false
      if (key === "DYLD_LIBRARY_PATH" || key === "DYLD_FRAMEWORK_PATH") return false
      if (key.startsWith("SWIFT_")) return false
      if (key.startsWith("NIX_")) return false
      return true
    }),
  )
}

const MACOS_THEME_MODE_SWIFT = `
import AppKit

func mode() -> String {
  UserDefaults.standard.string(forKey: "AppleInterfaceStyle") == "Dark" ? "dark" : "light"
}

print(mode())
fflush(stdout)

DistributedNotificationCenter.default().addObserver(
  forName: Notification.Name("AppleInterfaceThemeChangedNotification"),
  object: nil,
  queue: nil
) { _ in
  print(mode())
  fflush(stdout)
}

RunLoop.main.run()
`
