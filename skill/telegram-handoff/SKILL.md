---
name: telegram-handoff
description: Use when the user wants to continue the current Codex thread from Telegram, attach the current thread to a preconfigured Telegram bot, detach Telegram relay, or inspect the local Telegram bridge status.
---

# Telegram Handoff

## Overview

Attach the current Codex thread to the local Telegram bridge so the user can keep talking to the same thread from Telegram. Use this skill only for explicit handoff, detach, bootstrap, or status requests around the local Telegram bridge.

## Platform Rule

Prefer the Node CLI as the primary cross-platform entrypoint. Use shell-specific wrappers only as convenience:

- PowerShell: use `Join-Path $HOME ...`
- POSIX shell on macOS: use `"$HOME/..."`

## Quick Start

If the user wants to continue the current thread from Telegram:

1. Confirm the shell exposes `CODEX_THREAD_ID`.
2. Check current bridge status first:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') status
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" status
```

3. If the same thread is already attached and `serviceHealthy` is `true`, report that Telegram is already pointed at the current thread.
4. If the same thread is already attached but `serviceHealthy` is `false`, do not stop at status. Recover the daemon first by running `start-service`, then re-check `status`, and only then report readiness.
5. If a different thread is attached and the user explicitly wants to switch Telegram to the current thread, Codex may perform `detach` and then `attach` on the user's behalf as part of fulfilling that request.
6. If Codex knows the current session approval policy and sandbox mode from runtime context, it must pass them explicitly into the attach command instead of relying on shell environment variables. Replace the example values below with the real values from the current session.
7. Run the attach command that matches the current shell:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') attach --approval-policy never --sandbox-mode danger-full-access
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" attach --approval-policy never --sandbox-mode danger-full-access
```

8. `attach` will automatically start the local bridge daemon in the background if it is not already running.
9. While a thread is attached, the bridge will also launch a temporary tray/menu-bar companion.
10. Once the final Telegram binding is detached, the bridge and tray will auto-exit.
11. A successful fresh attach, or a same-thread daemon recovery, must leave the bridge-side Codex session ready for that thread before reporting success.
12. A successful fresh attach, or a same-thread daemon recovery, will also send a Telegram ready message with the current project name and thread label.
13. The ready message now also includes the thread id and the current access summary used for future Telegram relays.
14. If Codex did not write the current session permission into the attach command, the bridge must fall back to `readonly` and say so explicitly in the Telegram ready message.
15. If Codex writes malformed permission parameters, the CLI should fail loudly so Codex can retry with corrected values.
16. If the attached thread already has an unfinished turn, the initial Telegram ready message must warn about it instead of pretending the bridge is fully idle.
17. Report the attached thread id and remind the user that Telegram messages will continue the same thread.

If the user wants to stop Telegram relay for the current default chat:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') detach
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" detach
```

If the user wants bridge status:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') status
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" status
```

The returned status now reflects live bridge runtime details such as:

- whether the bridge process is healthy
- whether it is `idle`, `busy`, `draining`, `degraded`, or `ready_to_stop`
- the current queue depth
- the currently attached binding
- whether the bridge-side Codex session is actually ready for that thread

If the user explicitly wants manual daemon control:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') start-service
node (Join-Path $bridgeRoot 'src\cli.mjs') stop-service
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" start-service
node "$BRIDGE_ROOT/src/cli.mjs" stop-service
```

## Bootstrap

If `~/.codex/telegram-bridge/config.json` is missing, run the command that matches the current shell:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') init-config
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" init-config
```

Then tell the user to fill in:

- `telegramBotToken`
- `allowedChatIds`
- `defaultChatId`

Do not put real tokens into the skill file.

## Attach Rules

- Prefer the default chat from `config.json`.
- Rely on `CODEX_THREAD_ID`; do not guess the active thread from UI state.
- If `CODEX_THREAD_ID` is missing, stop and tell the user the current environment does not expose the active thread id.
- If shell type is known, choose the matching command form instead of guessing.
- Attach only on explicit user intent.
- The bridge keeps one active attached thread session at a time.
- Do not silently replace an existing different-thread binding with a new attach.
- If Telegram is already attached to another thread and the user explicitly wants to switch, prefer `status -> detach -> attach`.
- Codex may perform that detach-then-attach sequence automatically when the user has clearly asked to move Telegram to the current thread.
- If the current thread is already the attached thread, treat attach as an idempotent no-op and report that status clearly.
- If the current thread is already attached but `serviceHealthy` is `false`, prefer `start-service -> status` before telling the user Telegram is ready.
- If the bridge is healthy but `mode` is `degraded`, do not claim Telegram is ready; tell the user to re-run `attach` from the current Codex thread so the bridge-side session is prepared again.
- Do not infer attach-time permission defaults from `codex app-server` resume results.
- Prefer explicit Codex runtime permission arguments on the attach command.
- If Codex does not provide explicit permission arguments, use `readonly` as the fixed fallback and surface that fact in the Telegram ready message.
- If Codex provides explicit permission arguments but they are malformed, let the CLI fail instead of silently downgrading.

## Telegram Behavior

Once attached, the Telegram bridge will:

- relay normal text messages into the same Codex thread
- support `/help` to summarize the Telegram bridge commands
- support `/status` to inspect the current binding, runtime mode, queue depth, pending prompts, access profile, and active turn runtime when available
- `/status` should reflect the currently attached thread and its current running turn when known
- `/status` should include a short `当前运行消息: ...` preview when the running turn text can be identified
- support `/changes` to inspect concise git-style workspace changes from the attached project
- support `/last-error` to inspect the most recent bridge error recorded for this Telegram chat
- support `/cancel` for deterministic cancellation of a pending approval or question
- support `/interrupt` to stop the current running turn and clear queued Telegram messages so the user can resend cleanly
- `/interrupt` should act on the currently attached thread's running turn, even if the current bridge process did not start that turn
- if the session is degraded, `/interrupt` should tell the user to re-attach instead of attempting hidden recovery
- if `/interrupt` fails, it must report a clear error back to Telegram and must not block later `/status`, `/detach`, or normal messages
- support `/detach` as a deterministic detach alias
- support `/permission` to inspect the current bridge-side access profile and show an inline chooser for future Telegram relays
- detach on `回到 Codex`
- detach on `结束 Telegram 接管`
- detach on `detach`
- detach on `stop`
- detach on `pause relay`

The supported permission profiles are:

- send `/permission`, then tap `default`, `readonly`, `workspace`, or `full`
- `/permission default`
- `/permission readonly`
- `/permission workspace`
- `/permission full`

When the bridge is actively processing Telegram work, it will:

- show Telegram `typing`
- edit a single progress message in place with concise work summaries
- append `（持续工作中）` to in-flight progress text
- queue later Telegram messages per chat
- reply with `（codex还在运行上一个turn，结束后消息会送达codex）` when a message is queued
- clear the active Telegram binding when the bridge exits cleanly, so stale bindings do not block a later attach from another thread

If the tray/menu-bar companion is used to shut the bridge down while work is in progress, the bridge will:

- finish only the current running turn
- stop accepting new relay work
- drop queued but not-yet-started Telegram jobs
- auto-exit once the current turn completes

The tray's own shutdown action is stronger:

- tray shutdown should force-stop the bridge instead of waiting forever on a hung interrupt or stuck turn

## Serve Mode

Normally `attach` is enough because it auto-starts the bridge. Use `serve` directly only for debugging:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') serve
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" serve
```

Warn that:

- the bridge currently supports plain text only
- only configured chat ids are accepted
- the tray/menu-bar companion is shown only while the bridge is running
- if no release tray binary exists, the bridge falls back to `cargo run`, so Rust/Cargo must be available on `PATH`
- `codex app-server` is experimental and may require maintenance if the protocol changes

## Reference

For concrete commands, config paths, and wrapper options, read `references/protocol.md`.
