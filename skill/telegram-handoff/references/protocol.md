# Telegram Bridge Protocol

## Paths

- Bridge root: `~/.codex/telegram-bridge`
- CLI: `~/.codex/telegram-bridge/src/cli.mjs`
- Config: `~/.codex/telegram-bridge/config.json`
- Example config: `~/.codex/telegram-bridge/config.example.json`
- State: `~/.codex/telegram-bridge/state.json`

## Runtime Lifecycle

- `attach` auto-starts the bridge process if needed.
- When the bridge starts, it also starts a temporary tray companion:
  - Windows: notification area icon
  - macOS: menu-bar icon
- The tray is visible only while the bridge process is alive.
- If the final active Telegram binding is detached, the bridge transitions to `ready_to_stop` and exits automatically.
- When the bridge reaches a clean exit path (`ready_to_stop`), it clears `activeBindings` before stopping so stale bindings do not survive a dead daemon.
- If the tray requests shutdown while the bridge is idle, the bridge exits immediately.
- If the tray requests shutdown while a turn is running, the bridge enters `draining`:
  - the current turn is allowed to finish
  - queued but not-yet-started Telegram jobs are dropped
  - new Telegram relay input is rejected until the process exits

## Command Selection

Prefer the Node CLI as the default cross-platform interface.

- On PowerShell, resolve paths with `Join-Path $HOME ...`
- On macOS shells such as `sh`, `bash`, or `zsh`, resolve paths with `"$HOME/..."`
- Use wrapper scripts only when the user explicitly prefers them

## Commands

Initialize config:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') init-config
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" init-config
```

Attach current thread using `CODEX_THREAD_ID` and default chat:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') attach
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" attach
```

This command auto-starts the background bridge service if it is not already healthy.
The bridge also starts the tray/menu-bar companion automatically for the lifetime of the relay process.
If the chat is already attached to a different thread, `attach` now refuses to overwrite that binding and instructs the caller to detach first.
Attach-time permission behavior:

- First try to read desktop Codex permission context.
- If desktop permission context is unavailable, fall back to `readonly`.
- When that fallback happens, the Telegram ready message includes:
  `读取桌面端权限失败，采用默认权限 readonly`
- Do not use `codex app-server` resume permission data as the default attach permission source.

Attach explicit thread and chat:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') attach --chat-id 123456 --thread-id $env:CODEX_THREAD_ID
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" attach --chat-id 123456 --thread-id "$CODEX_THREAD_ID"
```

Recommended switch flow when Telegram is already attached to another thread:

1. Run `status` to inspect the current binding.
2. If the current binding already points to the desired thread, do nothing.
3. If the current binding points to a different thread and the user explicitly wants to move Telegram to the current thread, run `detach` and then `attach`.
4. Codex may execute that `detach -> attach` sequence automatically when the user's intent to switch threads is explicit.

Recommended recovery flow when Telegram is already attached to the current thread but the daemon is down:

1. Run `status`.
2. If `binding.threadId` already matches the current thread and `serviceHealthy` is `false`, do not stop at the binding check.
3. Run `start-service`.
4. Run `status` again and confirm `serviceHealthy: true` before telling the user Telegram is ready.

Detach:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') detach
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" detach
```

Status:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') status
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" status
```

Status returns both binding metadata and live runtime state, including:

- `serviceHealthy`
- `mode`
- `queueDepth`
- `binding`

Serve:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') serve
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" serve
```

`serve` is mainly for debugging. In normal use, prefer `attach`, which will start the bridge and tray automatically.

Manual daemon control:

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

Windows PowerShell wrappers:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
& (Join-Path $bridgeRoot 'start-telegram-bridge.ps1')
& (Join-Path $bridgeRoot 'stop-telegram-bridge.ps1')
& (Join-Path $bridgeRoot 'status-telegram-bridge.ps1')
```

macOS / POSIX wrappers:

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
"$BRIDGE_ROOT/start-telegram-bridge.sh"
"$BRIDGE_ROOT/stop-telegram-bridge.sh"
"$BRIDGE_ROOT/status-telegram-bridge.sh"
```

## Tray Companion Notes

- The tray companion reads the bridge control API from `http://127.0.0.1:<controlPort>`.
- A built tray executable is preferred when available.
- If no release tray binary exists, the launcher falls back to `cargo run --bin tray-companion`, so Rust/Cargo must be installed and available on `PATH`.
- The bridge passes the live control port to the tray companion automatically.

Local dry-run injection:

```powershell
$bridgeRoot = Join-Path $HOME '.codex\telegram-bridge'
node (Join-Path $bridgeRoot 'src\cli.mjs') inject --chat-id 123456 --text "continue from telegram"
```

```sh
BRIDGE_ROOT="$HOME/.codex/telegram-bridge"
node "$BRIDGE_ROOT/src/cli.mjs" inject --chat-id 123456 --text "continue from telegram"
```

## State Rules

- One Telegram chat can bind to only one Codex thread at a time.
- A later attach does not silently replace a different-thread binding.
- Switching to a different thread should happen through `detach` followed by `attach`.
- Relay is plain text only in the current MVP.
- Telegram does not get free-form thread switching.

## Telegram Runtime Commands

The Telegram side supports:

- `/help` for a concise bridge command summary
- `/status` for bridge-local runtime diagnostics
- `/changes` for concise git-style workspace changes from the bound project
- `/last-error` for the most recent bridge-side failure recorded for that chat
- `/cancel` to cancel a pending interactive approval or question
- `/detach` to stop relaying the current Telegram chat
- `/permission` to inspect or change the access profile used for future Telegram relays
