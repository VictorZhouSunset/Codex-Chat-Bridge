# bridge/tray-companion
Native tray companion that shows bridge status and provides a shutdown action without turning the tray into the primary control plane.
Rust owns the native menu/event-loop integration while Node remains the source of runtime truth over localhost status endpoints.
This folder should stay thin: UI state here mirrors the bridge runtime instead of re-implementing it.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `Cargo.toml` | Rust package manifest | Declares the tray companion crate and native dependencies. |
| `Cargo.lock` | dependency lockfile | Pins Rust dependencies for reproducible builds. |
| `src/` | Rust source | Implements status fetching, menu model mapping, and the tray event loop. |
