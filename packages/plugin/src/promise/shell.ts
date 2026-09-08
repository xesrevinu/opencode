import type { Hooks } from "./registration.js"

export interface ShellCreateBefore {
  command: string
  cwd: string
  timeout: number
  shell: string
  env: Record<string, string | undefined>
  /**
   * Whether the spawned shell reads its startup files. Set to false when `env`
   * carries an authoritative environment that startup files must not reorder.
   */
  startupFiles: boolean
}

export interface ShellHooks {
  readonly "create.before": ShellCreateBefore
}

export interface ShellDomain {
  readonly hook: Hooks<ShellHooks>
}
