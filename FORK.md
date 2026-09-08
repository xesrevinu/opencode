# Fork 维护指南

本仓库是 `anomalyco/opencode` 的定制 fork。上游文档仍在开发中，我们按自己的风格做了定制，本文记录改动范围与同步流程。

## 仓库布局

| Remote | 用途 |
| --- | --- |
| `upstream` | `anomalyco/opencode`，同步来源 |
| `origin` | `xesrevinu/opencode` |
| `new-origin` | `xesrevinu/opencode-new` |

主开发分支是本地 `v2`，跟踪 `upstream/v2`。短期功能分支验证后合并/快进到 `v2`；我们的改动**始终 rebase 到上游之上**，不做 merge 上游，保持线性历史。

`packages/session-viewer` 是本地只读多 agent transcript TUI，**永不推上游**。它叠在 `v2` 上，随 `v2` rebase，不单独长期分支。

查看当前定制内容：

```sh
git log --oneline upstream/v2..v2
```

commit SHA 每次 rebase 都会变化，所以本文按主题描述，不写死 SHA。

## 我们做了哪些改动

Session compaction 跟上游：文本摘要压缩，不维护 fork 自己的 native compact、`compaction.models` 候选链、compaction retry/`inputID`/stats。上游 AI 包的 `LLMClient.compact` 仍在，但 Session 不接。

### 1. Provider profiles

在 model-resolver 中引入 provider profile，把 Codex/Claude 等 client 身份写进 runtime model（user-agent、session 路由头）。

涉及 `packages/core/src/model-resolver.ts`、`packages/core/src/session/model-headers.ts`。

**冲突风险：高。** `model-resolver.ts` 是与上游 native AI 路由的主要交汇点。每次同步都要重点检查这里，并跑 `packages/core` 的 `model-resolver` 测试。

### 2. Shell 环境所有权（direnv 集成的基础）

让插件能完全掌管 spawn 出的 shell 环境。这是我们唯一改动公开 plugin 契约的地方：

`ShellCreateBefore` 增加可变的 `startupFiles: boolean` 字段。插件在 `shell.create.before` 中设为 `false`，表示 `env` 已是权威环境，shell 不应读取启动文件（`zsh -f`、`bash --noprofile --norc`，并清除 `BASH_ENV` / `ENV`）。

涉及 `packages/plugin/src/{effect,promise}/shell.ts`、`packages/core/src/shell.ts`、`packages/core/src/shell/select.ts`。

**为什么需要：** 启动文件会把自己的 PATH 前置，把项目 flake 的 bin 挤到后面，导致同名工具优先命中全局版本而非项目版本。

**关键约束：** `shell.create.before` 同时覆盖两条路径——agent 调用的 shell 工具，以及集成终端（`Session.shellCommand` → `Shell.create`）。后者**绕过** `tool.execute.before`，所以环境注入必须挂在 shell 钩子上，不能挂在 tool 钩子上。

### 3. 独立小修

- `fix(ai)`: HTTP 5xx 包裹下的 context overflow 识别
- `fix(ai)`: relay 的 `stream_read_error` / `upstream_error` 归类为可重试 provider failure，但明确的 upstream/provider access denial 归类为权限认证错误，避免对永久拒绝继续重试
- `fix(ai)`: text-only 工具结果 join 成纯字符串 `function_call_output`（数组形式仅在有 media 时保留）——sub2api 这类转 Chat Completions 的 relay 只认字符串形式，数组输出会被静默丢弃，shell 多段文本结果对模型不可见
- `chore(core)`: Codex client user agent 版本
- `chore(core)`: user agent 掩码为 `codex`（未配置构建为 `codex local`），`App.make()` 默认 channel 改为 `local`
- `fix(tui)`: 重试显示 `Locale.datetime` 计划时间，session 路由与 mini transport 同步
- `fix(tui)`: theme 启动等待上限、model catalog 校验等待
- `fix(core)`: 容忍本地 relay 的重叠/重复 reasoning fragment（`<base>:1` start、从未 start 的 `:0` end），不再整轮 die
- `test(core)`: AISDK 解析会经 `withProviderClientProfile` 重包（codex/claude client profile），返回的是新引用；`generate.test.ts` 的 `model: runtime` 引用相等断言改为断言解析结果字段
- `fix(core)`: managed service 启动时不自动恢复。上游已改成 turn-start 写 execution claim，boot 再扫孤儿 claim 并自动 resume；本 fork 把 `SessionRestart.resumeSuspendedSessions` 做成 no-op，claim 仍由 `SessionExecution` 落库，但启动不得写 continuation message 或调用 `SessionExecution.resume`。恢复必须来自后续明确的用户操作
- `feat(tui)`: 透明背景开关。`theme.transparent` 配置、Settings 入口、`theme.transparency` 命令与 `theme_transparency` keybind。opentui 终端输出层只区分 `alpha == 0`（透出终端背景）和 `alpha > 0`（输出不透明 RGB），所以主背景、diff block 与工具调用 block 在透明模式下设为 alpha 0，面板/弹窗保留 0.55 的帧缓冲 alpha 混合
- `fix(tui)`: system theme 自动切换。移植 V1 的 macOS 主题补丁：监听 `AppleInterfaceThemeChangedNotification`、直接处理 `?996/?997` Mode 2031 通知、palette 刷新前先同步 mode；普通 TUI 与 mini/direct footer 两条路径都覆盖。构建时 `packages/cli` 需要 `conditions: ["browser", "bun", "node"]`，否则 macOS watcher 使用的 browser condition 代码不会进入产物

这些互相独立，可自由重排。

### 4. 上游同步中的本地语义

rebase 到最新 `upstream/v2` 时，Session compaction 取上游实现，不要把 fork 的 native compact、`compaction.models`、`ratio`/`maxTokens`、retry 事件重新打回去。同步后跑 `packages/core` 的 `session-compaction` 与 `model-resolver` 测试。

2026-08 同步中上游落地 `refactor(ai): align multimodal naming`（`LLMError`→`AIError`、`Model`→`LanguageModel`），本地代码全部按新命名改写。rebase 中自动合并常把旧命名带进新文件，同步后用 `perl -pe 's/\bLLMError\b/AIError/g; s/\bModel\b/LanguageModel/g'` 全树清扫（跳过 `LanguageModel`/`ModelID` 等含词），再跑 `packages/{ai,core,tui}` 的 `bun typecheck` 与 `session-compaction`/`session-runner`/`provider-error` 定向测试兜底。全量 `packages/core` 测试时 `generate.test.ts` 的 AISDK 引用相等断言会失败（fork 的 provider client profile 重包所致），已适配为字段断言；`LocationServiceMap` 与 `PluginSupervisor config` 各有上游既有失败，非 fork 引入。

最近一次同步上游新增 Bedrock Mantle 原生支持，并把 `ModelResolver.resolve` 返回类型放宽为 `Resolved | undefined`。`generate.test.ts` 的 fork 适配现在需要先判空，再用 `String(...)` 解包品牌 ID 后断言。

本次同步上游把 config schema 所有权移到 `packages/schema`，并通过 `packages/core/src/config/normalize.ts` 显式筛选字段。不要复活已删除的 `packages/core/src/config/compaction.ts`。V1 `compaction.reserved` 按上游语义映射为 `buffer`。

上游 `fix: retry empty incomplete streams (#40535)` 已用 `InvalidProviderOutputReason.classification === "incomplete-stream"` 实现输出前重试。fork 原先按错误字符串 `Provider stream ended without a terminal finish event` 匹配的 commit 已在本次 rebase 丢弃；后续不要重新引入字符串匹配。

上游的 managed-service restart continuity 现在基于 write-ahead execution claim：turn 开始时落库，boot 枚举未释放的 claim、写 restart continuation synthetic message，并以 unbounded concurrency 自动 `SessionExecution.resume`。`packages/server/src/fetch.ts` 与 `process.ts` 都会触发这次扫。本 fork 保留 claim 的写入与释放（`SessionStore.claim`/`release`），但 `resumeSuspendedSessions` 必须是 no-op——启动不得消费 claim、写 continuation message 或调用 `SessionExecution.resume`。rebase 遇到 `packages/core/src/session/execution/restart.ts`、`packages/core/src/session/store.ts`、`packages/server/src/process.ts`、`packages/server/src/fetch.ts` 和 `packages/core/test/session-execution.test.ts` 冲突时保留这项本地语义；不要删掉 store 的 claim API，它们仍被 SessionExecution 使用。

2026-08-17 同步上游统一了 OpenAI Responses HTTP/WebSocket 传输（provider 不再单独暴露 `responsesWebSocket`），并给 TUI 加了 websocket continuation。本次 rebase 丢弃了上一轮的 openapi 再生 commit，schema/protocol 变更后应重新 `bun run generate`。

2026-09-08 同步到 `upstream/v2` @ `e8177238f6`。Session compaction 继续跟上游；fork 只 replay 非 compaction 定制（provider profiles、`startupFiles`、retry knobs、不自动 resume、TUI 透明/macOS 主题）。`@opencode-ai/*` 已随上游迁到 `@opencode/*`。`session-viewer` 仍在 `fun-apps`，不进 `v2`。

2026-08-30 同步到 `upstream/v2` @ `b1e3a7b222`（落后 353）。历史 59 个 fork commit 含多次同步胶水，无法逐条打到已重写的 runner/compaction 上；按线性历史把 fork 差量一次 replay，再补类型适配。

- 丢掉 `fix(core): keep model catalog available when plugin flush never settle`。上游 `#45783`（`complete supervisor flush when plugin activation fails`）才是正修：`activate()` 失败后仍 `ready.open`。本地 1 秒兜底要求 `booted=true`，plugin Die 时永远打不开 latch，`session.prompt` 会挂死。`PluginSupervisor config > unblocks flush when plugin activation fails` 必须保持通过。
- Command draft 仍只有 `add`，没有 `update`/`template`。外部 translate 插件必须改成 `draft.add`，否则每次 reload `Die`。
- Session runner `llm.ts` 随上游隔离 admission/controls 重写，本轮取上游 runner；`startupFiles`、`resumeSuspendedSessions` no-op 仍在 fork 侧。
- `AIError` 构造只剩 `{ reason }`，旧的 `module`/`method` 以及 `*Reason` 命名已全部换成 `*Error`。`HttpContext` 是 `{ url, status, headers }`。
- 重启 daemon 是 `system/org.nixos.opencode`（不是文档里旧的 `opencode-v2`）。
- `session-viewer` 已快进进 `v2`（独立 package + TUI row reducer 抽取）。同步上游时它会冲突在 `packages/tui/src/routes/session/rows.ts`：保留 `rows-reduce.ts` 抽取，并把上游新增的 `sessionRowID` / `backgroundToolRowIndex` 放进 reducer 文件。

## 跨仓库耦合

`~/.config/nixos/modules/home/opencode/config-v2/plugin/direnv.ts` 依赖本 fork 的 `shell.create.before` 契约（含 `startupFiles`）。改动该契约时必须同步更新该插件，否则项目级环境注入会静默失效。

## 同步流程

```sh
# 1. 抓取并查看上游进展
git fetch upstream --prune
git log --oneline upstream/v2 ^v2
git rev-list --left-right --count upstream/v2...v2

# 2. 预判冲突面
git diff --name-only upstream/v2..v2 | sort > /tmp/ours.txt
git diff --name-only $(git merge-base upstream/v2 v2)..upstream/v2 | sort > /tmp/theirs.txt
comm -12 /tmp/ours.txt /tmp/theirs.txt

# 3. 建回滚点
git branch -f v2-prerebase-backup v2

# 4. rebase（GPG 与空 commit 处理见下）
git -c commit.gpgsign=false rebase --empty=drop upstream/v2
```

同步后检查是否有 commit 已被上游实现而变成冗余。上游若刷新了 lockfile 或落地了等价功能，我们对应的 commit 应当丢弃而不是保留——留着只会在每次 rebase 制造冲突。

确认结果无误后删除回滚点：

```sh
git branch -D v2-prerebase-backup
```

## 每次改动后要做什么

按改动类型选最窄的验证。根目录 `bun test` 被禁用，必须进入具体 package。

| 改动类型 | 必做 |
| --- | --- |
| schema / protocol | `packages/protocol` 与 `packages/client` 的 `bun run check:generated`；生成物与 schema **同一个 commit** |
| core 行为 | `packages/core` 的 `bun run typecheck` + 相关定向测试 |
| plugin 契约 | `plugin` 与 `core` typecheck；同步更新外部插件（见「跨仓库耦合」） |
| shell / 环境 | 重建 CLI、重启 service，**两条路径都验证** |
| app / tui | 对应 package 的 typecheck 与测试 |

### 生成物

`packages/client` 的 `check:generated` 内部用 `git diff --exit-code`。若 schema 改动未提交或未 stage，它会因为看到「未提交的生成结果」而失败，这不代表生成物不一致。正确做法是先 stage schema 与生成物，再跑检查。

不要手改 `packages/client/src/generated*`、`src/effect/api`、`packages/protocol/openapi.json`，一律通过 `bun run generate`。

### 构建与重启

```sh
cd packages/cli && bun run build --single --skip-install
```

重启必须与验证**分开执行**，因为重启会中断调用它的命令：

```sh
sudo launchctl kickstart -k system/org.nixos.opencode
```

用绝对路径，因为进入项目 flake 后 `~/.local/bin` 不在 PATH 上。重启后核对 `opencode2 --version` 与新构建版本一致——service 可能仍在跑旧二进制。

### shell / 环境改动的双路径验证

集成终端路径（不经过 agent）：

```sh
D=%2Fpath%2Fto%2Fproject
curl -sS --max-time 60 -u "opencode:$(opencode2 service get password)" -X POST http://127.0.0.1:4097 "/api/shell?location%5Bdirectory%5D=$D" \
  --data '{"command":"/usr/bin/env -0 > /tmp/probe.env","timeout":15000}'
```

输出落在 `~/.local/share/opencode/shell/<projectID>/<shellID>.out`，projectID 未必是你预期的那个，用 `find` 定位。

agent 工具路径：

```sh
opencode2 run --auto -m <model> "Run exactly this shell command once: ..."
```

环境正确性的判据是与真实终端 parity。参考基准用 PTY 交互式 login shell 加 direnv：

```sh
/usr/bin/script -q /dev/null /bin/zsh -ilc 'direnv exec <dir> /usr/bin/env -0 > /tmp/ref.env'
```

比对变量名集合与 PATH 目录集合，并确认**项目 bin 的位置顺序**，不只是存在性。`script(1)` 自身会注入 `SCRIPT` 变量，属于假影。

## 已知陷阱

- **插件 `console.warn` 不进 server log。** 诊断插件行为要用可观测的副作用，例如临时改写命令输出标记，用完立刻移除。
- **config 目录插件热重载不可靠。** hardlink 改动 mtime 未必触发重载，改完插件要重启 service。
- **`bun install` 会产生 lockfile 噪音。** 本机会重排 `trustedDependencies` / `patchedDependencies` 键序而不改任何依赖。不要提交，用 `git restore --source=HEAD --worktree bun.lock` 还原。
- **上游既有 lint 失败不要修。** `bun run lint` 有 1 个 error（`packages/session-ui`），`bun run lint:effect-patterns` 有 6 个 error，全在我们未改动且上游同样存在的文件里。只需确认没有新增。
- **GPG 签名。** 全局 `commit.gpgsign=true`，提交与 rebase 都要带 `-c commit.gpgsign=false`。
- **交互式 rebase 会卡在编辑器。** 非交互场景用 `GIT_SEQUENCE_EDITOR=true GIT_EDITOR=true`。
