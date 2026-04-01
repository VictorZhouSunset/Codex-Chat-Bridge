# bridge
Bridge package that owns the Node daemon, Telegram transport, local state handling, and the Rust tray companion.
`src/` contains runtime logic, `tests/` contains Node integration/unit coverage, and `tray-companion/` contains the native system tray process.
The package should stay install-first: configuration and runtime state live outside git in the installed `~/.codex` copy.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `package.json` | package manifest | Defines bridge-local scripts and package metadata. |
| `config.example.json` | sample runtime config | Shows the expected Telegram token/chat allowlist configuration shape. |
| `start-telegram-bridge.ps1` | Windows wrapper | Starts the bridge daemon via PowerShell. |
| `stop-telegram-bridge.ps1` | Windows wrapper | Stops the bridge daemon via PowerShell. |
| `status-telegram-bridge.ps1` | Windows wrapper | Queries bridge status via PowerShell. |
| `start-telegram-bridge.sh` | POSIX wrapper | Starts the bridge daemon from POSIX shells. |
| `stop-telegram-bridge.sh` | POSIX wrapper | Stops the bridge daemon from POSIX shells. |
| `status-telegram-bridge.sh` | POSIX wrapper | Queries bridge status from POSIX shells. |
| `src/` | Node runtime | Implements CLI, bridge daemon, transport adapters, and runtime helpers. |
| `scripts/` | developer tooling | Hosts deterministic local helper scripts such as the serial Node test runner. |
| `tests/` | verification suite | Covers bridge runtime behavior and Codex integration shims. |
| `tray-companion/` | native tray process | Hosts the Rust binary that surfaces shutdown/status in the OS tray. |
