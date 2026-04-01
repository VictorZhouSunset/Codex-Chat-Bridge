# docs/architecture/c4
Canonical C4 source for the bridge system.
This folder should stay small and stable: one workspace file with stable identifiers is enough for this repository today.
When runtime units or component boundaries change, update this folder before calling the refactor complete.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `workspace.dsl` | C4 source of truth | Defines the system, containers, and key bridge runtime components with stable identifiers. |
