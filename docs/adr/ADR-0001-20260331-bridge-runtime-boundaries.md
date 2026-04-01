# ADR-0001: Split bridge runtime around explicit relay submodules
Status: Accepted
Links: C4:docs/architecture/c4/workspace.dsl#bridge_runtime; Module:bridge/src

## Context

The repository started as an extracted working copy from `~/.codex`, which made fast iteration easy but left the bridge runtime concentrated in one oversized module: `bridge/src/bridge-service.mjs`. That file mixed per-chat queue orchestration, Telegram progress editing, interactive approval/question handling, shutdown state transitions, and permission switching in one place. The code was still functional, but it made the new `ARCH.md` contracts hard to trust because the implementation boundaries did not mirror the intended architecture.

The project also needs to stay extensible beyond Telegram. That does not require abstracting all chat platforms today, but it does require making the relay runtime legible enough that another adapter can reuse the same lifecycle concepts later.

## Decision

Keep the external runtime shape stable:

- one Node bridge daemon
- one Rust tray companion
- one Codex skill package

Within the Node bridge daemon, split the runtime around explicit submodules:

- `bridge-service.mjs` remains the top-level orchestrator for bindings, queue lifecycle, shutdown mode, and access changes
- Telegram progress/typing behavior moves into a dedicated runtime helper module
- interactive approval/question prompting moves into a dedicated runtime helper module
- folder `ARCH.md` files become mandatory for the touched folders so the implementation map stays current

We also adopt a repository-level architecture set:

- root `ARCH.md`
- folder `ARCH.md` files for key development folders
- one accepted ADR
- one Structurizr DSL workspace as the C4 source of truth

## Consequences

Positive:

- `bridge-service.mjs` becomes smaller and easier to map to the architecture docs
- new contributors can understand where to change progress handling versus interactive prompt logic
- the runtime is easier to extend toward non-Telegram adapters without premature abstraction
- architecture documentation becomes a real maintenance tool instead of a one-off artifact

Negative:

- more files must stay synchronized
- tests may need to split over time to follow the new module boundaries
- contributors now need to update headers and folder docs as part of normal development

## Alternatives Considered

### Keep the bridge runtime as one large orchestrator file

Rejected because the code/documentation boundary mismatch is already large enough to slow review and future extension.

### Rewrite the bridge into a fully generic multi-adapter framework now

Rejected because the product only has a Telegram implementation today. That level of abstraction would add indirection before the second adapter exists.

### Move progress and interactive logic into the tray or skill layer

Rejected because both concerns are runtime bridge responsibilities tied to relay execution, not UI-only or skill-only behavior.
