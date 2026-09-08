import { ConfigProvider, resolve } from "@opencode/tui/config"
import { ClipboardProvider } from "@opencode/tui/context/clipboard"
import { Keymap } from "@opencode/tui/context/keymap"
import { ThemeProvider, createThemeSource } from "@opencode/tui/context/theme"
import { DialogProvider } from "@opencode/tui/ui/dialog"
import { ToastProvider } from "@opencode/tui/ui/toast"
import { render } from "@opentui/solid"
import path from "node:path"
import type { AgentHomes, SessionFilter } from "../model"
import { resolveHomes } from "../homes"
import { ViewerApp } from "./app"
import { createCliConfigService, cliConfigPath } from "./config"

const clipboard = {
  read: async () => undefined,
  write: async () => {},
}

export async function runSessionViewer(input: { homes?: AgentHomes; filter: SessionFilter }) {
  const service = createCliConfigService()
  const configDir = path.dirname(service.path ?? cliConfigPath())
  const config = resolve(await service.get(), { terminalSuspend: process.platform !== "win32" })
  await render(
    () => (
      <ClipboardProvider value={clipboard}>
        <ConfigProvider config={config} service={service} options={{ terminalSuspend: process.platform !== "win32" }}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={createThemeSource(configDir)}>
              <ToastProvider>
                <DialogProvider>
                  <ViewerApp homes={resolveHomes(input.homes)} initialFilter={input.filter} />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </ClipboardProvider>
    ),
    {
      exitOnCtrlC: false,
      targetFps: 30,
      useMouse: config.mouse,
      autoFocus: true,
    },
  )
}
