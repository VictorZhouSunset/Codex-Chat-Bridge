# bridge/scripts
Small Node helper scripts that support local quality gates and packaging tasks.
Scripts here should stay deterministic, cross-platform, and narrowly focused on developer workflow support.
Do not move bridge runtime logic here; these scripts exist to support the runtime package, not replace it.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `run-node-tests.mjs` | local gate helper | Executes each Node test file serially to keep JS verification deterministic. |
