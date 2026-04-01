# bridge/src
Node runtime for the Codex chat bridge, centered around a small CLI, a relay orchestration service, and adapter modules.
`cli.mjs` is the only human-facing entrypoint; everything else should stay composable and testable behind it.
The largest coordination module is `bridge-service.mjs`, while formatters, stores, transport adapters, and status helpers stay split out by responsibility.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `cli.mjs` | process entrypoint | Parses commands, starts/stops the bridge daemon, and attaches/detaches thread bindings. |
| `bridge-service.mjs` | runtime orchestrator | Owns per-chat relay queues, shutdown mode, interactive prompt flow, and access updates. |
| `codex-app-server.mjs` | Codex transport adapter | Wraps the Codex app-server JSON-RPC protocol used for thread resume and turn relay. |
| `codex-app-server-protocol.mjs` | protocol helper | Normalizes app-server interactive requests and sandbox-mode translations. |
| `cli-support.mjs` | CLI helper | Holds reusable argument parsing, allowlist, port, and usage helpers for the CLI. |
| `telegram-api.mjs` | Telegram transport adapter | Wraps Telegram Bot API calls used by the bridge, including inline keyboards and callback acknowledgements. |
| `control-server.mjs` | local control plane | Exposes health, runtime status, and shutdown over localhost HTTP. |
| `binding-store.mjs` | persistent state access | Reads and writes active bindings plus Telegram polling offset. |
| `bridge-diagnostics.mjs` | diagnostics helper | Builds Telegram-facing help/status/error replies and reads concise workspace changes. |
| `access-profile.mjs` | permission translator | Captures attach-time access defaults and applies Telegram-side permission overrides. |
| `desktop-access-context.mjs` | desktop permission reader | Resolves attach-time access from desktop Codex context when available and otherwise falls back to readonly safely. |
| `commands.mjs` | Telegram command classifier | Turns Telegram text or permission callback payloads into detach, cancel, permission, or relay intents. |
| `interactive-prompt-manager.mjs` | interactive runtime helper | Owns approval/question queues, Telegram prompts, and reply parsing. |
| `telegram-progress.mjs` | Telegram UX helper | Owns typing indicators and throttled progress message send/edit behavior. |
| `serve-loop.mjs` | polling loop | Fetches Telegram messages and callback queries, then hands them to the runtime safely. |
| `attach-notification.mjs` | attach announcement helper | Builds the initial “Telegram ready” message after a successful attach. |
| `daemon-control.mjs` | daemon client | Talks to the localhost control server for health checks and shutdown. |
| `progress-summary.mjs` | progress formatter | Collapses Codex item events into short Telegram-friendly status lines. |
| `relay-result.mjs` | completion observer | Normalizes relay completion promises for detached loop usage. |
| `tray-companion.mjs` | tray launcher | Spawns or reuses the Rust tray process from the Node daemon. |
