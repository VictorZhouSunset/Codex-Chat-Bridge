# bridge/tests/helpers/bridge-service
Concern-focused helper modules for bridge-service-related tests.
These helpers keep filesystem/timing doubles separate from Telegram transport doubles so the test barrel stays readable.
The barrel file one level up should only aggregate these helpers, not re-grow back into a mega-fixture.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `state-fixtures.mjs` | state/time helper | Provides temp state paths, task flushing, and manual-clock fixtures for deterministic bridge-service tests. |
| `telegram-fixtures.mjs` | Telegram fixture helper | Provides fake Telegram APIs and blocked-send variants for lifecycle, queueing, and progress suites. |
