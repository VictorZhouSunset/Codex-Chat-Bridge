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
6. Run the attach command that matches the current shell:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') attach
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" attach
```

7. `attach` will automatically start the local bridge daemon in the background if it is not already running.
8. While a thread is attached, the bridge will also launch a temporary tray/menu-bar companion.
9. Once the final Telegram binding is detached, the bridge and tray will auto-exit.
10. A successful fresh attach, or a same-thread daemon recovery, will also send a Telegram ready message with the current project name and thread label.
11. The ready message now also includes the thread id and the current access summary used for future Telegram relays.
12. If desktop Codex permission context cannot be read at attach time, the bridge must fall back to `readonly` and say so explicitly in the Telegram ready message.
13. Report the attached thread id and remind the user that Telegram messages will continue the same thread.

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
- whether it is `idle`, `busy`, `draining`, or `ready_to_stop`
- the current queue depth
- the currently attached binding

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
- The bridge is single-binding per Telegram chat.
- Do not silently replace an existing different-thread binding with a new attach.
- If Telegram is already attached to another thread and the user explicitly wants to switch, prefer `status -> detach -> attach`.
- Codex may perform that detach-then-attach sequence automatically when the user has clearly asked to move Telegram to the current thread.
- If the current thread is already the attached thread, treat attach as an idempotent no-op and report that status clearly.
- If the current thread is already attached but `serviceHealthy` is `false`, prefer `start-service -> status` before telling the user Telegram is ready.
- Do not infer attach-time permission defaults from `codex app-server` resume results.
- Prefer explicit desktop Codex permission context when it is available; otherwise use `readonly` as the fixed fallback.

## Telegram Behavior

Once attached, the Telegram bridge will:

- relay normal text messages into the same Codex thread
- support `/help` to summarize the Telegram bridge commands
- support `/status` to inspect the current binding, runtime mode, queue depth, pending prompts, and access profile
- support `/changes` to inspect concise git-style workspace changes from the attached project
- support `/last-error` to inspect the most recent bridge error recorded for this Telegram chat
- support `/cancel` for deterministic cancellation of a pending approval or question
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
