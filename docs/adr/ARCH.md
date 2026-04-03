# docs/adr
Decision log for structural choices that affect module boundaries, public interfaces, or major trade-offs.
Each ADR should link back to a stable C4 element and the owning module folder.
Do not rewrite history here; supersede older ADRs instead.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `ADR-0001-20260331-bridge-runtime-boundaries.md` | accepted ADR | Records the decision to split the bridge runtime around explicit runtime submodules and document-first boundaries. |
| `ADR-0002-20260402-bridge-runtime-support-modules.md` | accepted ADR | Records the internal support-module split for bridge-session state and bridge-service test fixtures while keeping runtime behavior stable. |
