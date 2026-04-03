# bridge/src/bridge-service
Internal support modules for the main bridge runtime orchestrator.
These files keep `bridge-service.mjs` focused on orchestration while moving attached-session state, command handling, and runtime helpers into named seams.
They are not separate entrypoints; they exist to keep the runtime architecture legible and testable.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `attached-session-state.mjs` | session state helper | Owns attached-session snapshots, observed-turn tracking, turn epochs, and interrupt-session matching. |
| `command-handlers.mjs` | command helper | Implements permission, status, changes, and last-error command flows shared by `BridgeService`. |
| `runtime-helpers.mjs` | shared utility helper | Provides shutdown-message formatting plus turn-deduplication and timing helpers for the runtime. |
