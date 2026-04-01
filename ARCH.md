# codex-chat-bridge
Install-first bridge that lets a Codex thread continue inside external chat channels while keeping Codex as the source of truth.
The repository contains one Node-based bridge daemon, one Rust tray companion, and one Codex skill package.
This root file maps the repository by runnable area and points readers toward the more detailed folder-level architecture notes.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `README.md` | onboarding entrypoint | Explains install-first usage, Telegram setup, and Codex integration flow. |
| `install.ps1` | Windows installer | Copies bridge and skill assets into `~/.codex` with Windows-safe defaults. |
| `install.sh` | POSIX installer | Copies bridge and skill assets into `~/.codex` for macOS and other POSIX systems. |
| `bridge/` | runtime package | Houses the bridge daemon, tests, and tray companion implementation. |
| `skill/` | Codex skill package | Ships the `telegram-handoff` skill that invokes the installed bridge. |
| `docs/` | architecture and decision records | Stores ADRs, C4 diagrams, folder contracts, and green checkpoints. |
