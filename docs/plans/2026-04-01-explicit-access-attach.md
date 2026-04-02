# Explicit Access Attach Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Telegram attach use the current Codex session access explicitly when the agent knows it, instead of relying only on environment variables.

**Architecture:** Extend the bridge CLI so `attach` can accept explicit approval and sandbox flags, then make access resolution prefer explicit CLI input over environment-derived context and finally fall back to readonly. Update the `telegram-handoff` skill so Codex must pass the current session access into the CLI when that information is available in agent context.

**Tech Stack:** Node.js ESM, native `node:test`, Codex skill markdown

---

### Task 1: Add failing tests for explicit attach access inputs

**Files:**
- Modify: `D:/2025-27_CS_AI/Projects/codex-chat-bridge/bridge/tests/cli-support.test.mjs`
- Modify: `D:/2025-27_CS_AI/Projects/codex-chat-bridge/bridge/tests/desktop-access-context.test.mjs`

**Step 1: Write the failing tests**

- Add a CLI helper test that verifies `--approval-policy` and `--sandbox-mode` are parsed and surfaced for attach-time access resolution.
- Add desktop access context tests that verify explicit CLI inputs win over env values and that invalid explicit values fall back to readonly with the existing notice.

**Step 2: Run tests to verify they fail**

Run:

```powershell
node --test D:/2025-27_CS_AI/Projects/codex-chat-bridge/bridge/tests/cli-support.test.mjs D:/2025-27_CS_AI/Projects/codex-chat-bridge/bridge/tests/desktop-access-context.test.mjs
```

Expected: FAIL because the helper and resolver do not yet support explicit attach access flags.

### Task 2: Implement explicit attach access resolution

**Files:**
- Modify: `D:/2025-27_CS_AI/Projects/codex-chat-bridge/bridge/src/cli-support.mjs`
- Modify: `D:/2025-27_CS_AI/Projects/codex-chat-bridge/bridge/src/desktop-access-context.mjs`
- Modify: `D:/2025-27_CS_AI/Projects/codex-chat-bridge/bridge/src/cli.mjs`

**Step 1: Add minimal helper support**

- Teach the CLI helper layer to read explicit access flags from parsed args.
- Teach desktop access resolution to prefer explicit values, then env, then readonly fallback.
- Pass the parsed explicit access context through `attachCommand`.

**Step 2: Run focused tests**

Run:

```powershell
node --test D:/2025-27_CS_AI/Projects/codex-chat-bridge/bridge/tests/cli-support.test.mjs D:/2025-27_CS_AI/Projects/codex-chat-bridge/bridge/tests/desktop-access-context.test.mjs
```

Expected: PASS.

### Task 3: Update the skill contract

**Files:**
- Modify: `C:/Users/xiaoy/.codex/skills/telegram-handoff/SKILL.md`
- Modify: `D:/2025-27_CS_AI/Projects/codex-chat-bridge/skill/telegram-handoff/SKILL.md`
- Modify: `D:/2025-27_CS_AI/Projects/codex-chat-bridge/skill/telegram-handoff/references/protocol.md`

**Step 1: Document the new rule**

- State clearly that when Codex knows the current session approval/sandbox from runtime context, it must pass them explicitly to the CLI attach command.
- Keep readonly fallback behavior documented for contexts where that information is unavailable.

**Step 2: Validate the skill and sync local install**

Run:

```powershell
$env:PYTHONUTF8='1'
uv run --with pyyaml python C:/Users/xiaoy/.codex/skills/.system/skill-creator/scripts/quick_validate.py D:/2025-27_CS_AI/Projects/codex-chat-bridge/skill/telegram-handoff
```

Expected: PASS.

### Task 4: Verify and sync live install

**Files:**
- Modify: `D:/2025-27_CS_AI/Projects/codex-chat-bridge/docs/green-checkpoints.md`
- Modify: `C:/Users/xiaoy/.codex/telegram-bridge/src/cli-support.mjs`
- Modify: `C:/Users/xiaoy/.codex/telegram-bridge/src/desktop-access-context.mjs`
- Modify: `C:/Users/xiaoy/.codex/telegram-bridge/src/cli.mjs`

**Step 1: Run focused verification**

Run:

```powershell
node --test D:/2025-27_CS_AI/Projects/codex-chat-bridge/bridge/tests/cli-support.test.mjs D:/2025-27_CS_AI/Projects/codex-chat-bridge/bridge/tests/desktop-access-context.test.mjs
```

Expected: PASS.

**Step 2: Sync to `~/.codex` and record checkpoint**

- Copy the changed bridge files into `C:/Users/xiaoy/.codex/telegram-bridge/src/`
- Copy the updated skill files into `C:/Users/xiaoy/.codex/skills/telegram-handoff/`
- Add a new entry to `docs/green-checkpoints.md`
