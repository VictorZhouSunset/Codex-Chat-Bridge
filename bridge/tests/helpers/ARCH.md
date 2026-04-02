## bridge/tests/helpers
Shared test fixtures for the bridge runtime and app-server adapter suites.
Keep these helpers deterministic and side-effect free so concern-based test files stay easy to read.
When a helper starts encoding product policy instead of fake I/O shape, move that logic into a dedicated runtime helper module and test it there.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `bridge-service-fixtures.mjs` | bridge runtime fixture bundle | Provides fake Telegram APIs, fake Codex clients, interruptible relay stubs, temporary state paths, and manual clock helpers for bridge runtime tests. |
| `codex-app-server-fixtures.mjs` | app-server fixture bundle | Provides fake JSON-RPC Codex processes for client lifecycle, progress, access, and interactive request tests. |
