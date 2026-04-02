# bridge/tests
Node test suite for the bridge runtime and adapter modules.
Tests are intentionally integration-heavy around the bridge runtime because reliability matters more than narrow mock coverage here.
When a source module is split, its tests should usually split with it instead of growing one mega-suite forever.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `bridge-service-binding.test.mjs` | bridge binding suite | Covers attach, detach, relay basics, and permission command behavior. |
| `bridge-service-diagnostics.test.mjs` | bridge diagnostics suite | Covers help, status, degraded-session reporting, current attached-thread runtime reporting, changes, and last-error Telegram command behavior. |
| `bridge-service-queue.test.mjs` | bridge queue suite | Covers busy-thread queueing, attached-thread busy detection, and ordered relay execution. |
| `bridge-service-progress.test.mjs` | bridge progress suite | Covers typing-first behavior and throttled Telegram progress updates. |
| `bridge-service-interactive.test.mjs` | bridge interactive suite | Covers approval routing, user input prompts, and interactive detach behavior. |
| `bridge-service-lifecycle.test.mjs` | bridge lifecycle suite | Covers draining, shutdown, singleton attach-session replacement, auto-exit, worker failure settlement, and slash interrupt behavior. |
| `codex-app-server-core.test.mjs` | protocol core suite | Verifies client initialization, thread reads, attached-session setup, and session-aware relay/interrupt behavior. |
| `codex-app-server-progress.test.mjs` | protocol progress suite | Verifies JSON-RPC progress aggregation into Telegram-facing summaries. |
| `codex-app-server-interactive.test.mjs` | protocol interactive suite | Verifies approval and request_user_input server-request handling. |
| `codex-app-server-access.test.mjs` | protocol access suite | Verifies approval and sandbox override mapping across resume and turn start. |
| `codex-app-server-protocol.test.mjs` | protocol helper suite | Verifies app-server request normalization and sandbox-mode mapping. |
| `binding-store.test.mjs` | persistence suite | Verifies binding persistence, conflict handling, and state updates. |
| `cli-support.test.mjs` | CLI helper suite | Verifies CLI parsing, explicit attach-access parsing, and allowlist/control-port helpers. |
| `desktop-access-context.test.mjs` | attach access suite | Verifies explicit Codex-provided attach access handling, validation, and readonly fallback. |
| `control-server.test.mjs` | control plane suite | Verifies health, status, and shutdown HTTP responses. |
| `daemon-control.test.mjs` | daemon client suite | Verifies localhost status/shutdown requests and health checks. |
| `serve-loop.test.mjs` | Telegram polling suite | Verifies polling, offset progression, and error handling. |
| `commands.test.mjs` | command parsing suite | Verifies Telegram command classification. |
| `interactive-prompt-manager.test.mjs` | interactive helper suite | Verifies prompt queueing, reply parsing, and cancellation behavior. |
| `progress-summary.test.mjs` | formatter suite | Verifies Telegram progress summary formatting. |
| `run-node-tests.test.mjs` | tooling suite | Verifies deterministic ordering for the serial JS test runner. |
| `telegram-progress.test.mjs` | progress helper suite | Verifies typing and throttled Telegram progress updates. |
| `attach-notification.test.mjs` | attach announcement suite | Verifies ready-message formatting and resend decisions. |
| `tray-companion.test.mjs` | tray launcher suite | Verifies Node-side tray process spawning and reuse. |
| `relay-result.test.mjs` | helper suite | Verifies detached relay completion observation. |
| `helpers/` | fixture support directory | Holds shared fake Telegram APIs and fake app-server processes for concern-based suites. |
