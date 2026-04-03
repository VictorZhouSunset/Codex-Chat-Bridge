# ADR-0002: Add internal support modules for bridge runtime orchestration
Status: Accepted
Links: C4:docs/architecture/c4/workspace.dsl#bridge_runtime_support; Module:bridge/src/bridge-service

## Context

`bridge/src/bridge-service.mjs` remained the public runtime facade, but attached-session bookkeeping, Telegram command shaping, and interrupt/shutdown helper logic were still concentrated inside one file. The bridge test side had the same issue in `bridge/tests/helpers/bridge-service-fixtures.mjs`, where Telegram doubles, temp-state helpers, and Codex-client fakes had started growing together.

The existing runtime behavior was already covered by bridge-service integration tests, so the main need was structural: make the implementation boundaries line up with the folder-level `ARCH.md` contracts without changing the outward runtime API.

## Decision

Keep the current external runtime shape unchanged:

- `BridgeService` remains the single public bridge runtime class
- bridge-service tests keep importing the same fixture barrel path

Split internal concerns underneath those stable surfaces:

- add `bridge/src/bridge-service/` for attached-session state, command handlers, and shared runtime helpers
- keep `bridge/src/bridge-service.mjs` as the orchestration facade over those support modules
- add `bridge/tests/helpers/bridge-service/` for state/time fixtures and Telegram API doubles
- keep `bridge/tests/helpers/bridge-service-fixtures.mjs` as a compatibility barrel around the split test helpers

## Consequences

Positive:

- `bridge-service.mjs` now reads as the runtime facade instead of the entire implementation
- test helper boundaries now match runtime concerns more closely
- `ARCH.md` files can describe stable internal seams instead of one oversized source file

Negative:

- there are more small internal files to keep synchronized
- bridge runtime changes now require checking both the facade file and its support folder

## Alternatives Considered

### Keep the new logic inside the existing large files

Rejected because the code structure would keep drifting away from the architecture docs.

### Fully split the public bridge runtime API into multiple top-level entrypoints

Rejected because the runtime does not need a new public surface yet; the problem was internal concentration, not public API sprawl.
