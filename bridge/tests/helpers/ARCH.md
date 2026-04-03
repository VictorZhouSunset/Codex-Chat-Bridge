## bridge/tests/helpers
Shared test fixtures for the bridge runtime and app-server adapter suites.
Keep these helpers deterministic and side-effect free so concern-based test files stay easy to read.
Bridge-service fixtures now use a barrel plus concern-specific submodules so timing/state helpers and Telegram doubles can evolve separately.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `bridge-service-fixtures.mjs` | bridge runtime fixture barrel | Re-exports split state/Telegram helpers while keeping the larger Codex-client fixture surface stable for existing suites. |
| `bridge-service/` | bridge fixture support directory | Holds concern-specific bridge-service helper modules such as state/time fixtures and Telegram API doubles. |
| `codex-app-server-fixtures.mjs` | app-server fixture bundle | Provides fake JSON-RPC Codex processes for client lifecycle, progress, access, and interactive request tests. |
