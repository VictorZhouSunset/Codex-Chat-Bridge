import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";

import {
  attachBinding,
  createEmptyState,
  detachBinding,
  ensureStateFile,
  getBinding,
} from "../src/binding-store.mjs";

test("attach is idempotent when the same chat is already bound to the same thread", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tg-bridge-bindings-"));
  const statePath = path.join(tempDir, "state.json");

  await ensureStateFile(statePath);
  const firstBinding = await attachBinding(statePath, {
    chatId: "1001",
    threadId: "thread-a",
    threadLabel: "A",
    cwd: "D:\\alpha",
  });
  const binding = await attachBinding(statePath, {
    chatId: "1001",
    threadId: "thread-a",
    threadLabel: "A newer label should not replace the existing one",
    cwd: "D:\\beta",
  });

  assert.equal(binding?.threadId, "thread-a");
  assert.equal(binding?.threadLabel, "A");
  assert.equal(binding?.cwd, "D:\\alpha");
  assert.equal(binding?.attachedAt, firstBinding.attachedAt);
});

test("attach backfills missing access on an existing same-thread binding", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tg-bridge-bindings-"));
  const statePath = path.join(tempDir, "state.json");

  await ensureStateFile(statePath);
  const firstBinding = await attachBinding(statePath, {
    chatId: "1001",
    threadId: "thread-a",
    threadLabel: "A",
    cwd: "D:\\alpha",
  });
  const binding = await attachBinding(statePath, {
    chatId: "1001",
    threadId: "thread-a",
    threadLabel: "A",
    cwd: "D:\\alpha",
    access: {
      defaultApprovalPolicy: "never",
      defaultSandboxPolicy: { type: "dangerFullAccess" },
      overrideApprovalPolicy: null,
      overrideSandboxPolicy: null,
    },
  });

  assert.equal(binding?.attachedAt, firstBinding.attachedAt);
  assert.deepEqual(binding?.access, {
    defaultApprovalPolicy: "never",
    defaultSandboxPolicy: { type: "dangerFullAccess" },
    overrideApprovalPolicy: null,
    overrideSandboxPolicy: null,
  });
});

test("attach rejects replacing an existing binding with a different thread", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tg-bridge-bindings-"));
  const statePath = path.join(tempDir, "state.json");

  await ensureStateFile(statePath);
  await attachBinding(statePath, {
    chatId: "1001",
    threadId: "thread-a",
    threadLabel: "A",
    cwd: "D:\\alpha",
  });

  await assert.rejects(
    attachBinding(statePath, {
      chatId: "1001",
      threadId: "thread-b",
      threadLabel: "B",
      cwd: "D:\\beta",
    }),
    (error) => {
      assert.equal(error?.code, "BINDING_CONFLICT");
      assert.match(error?.message ?? "", /already attached/i);
      assert.match(error?.message ?? "", /thread-a/);
      return true;
    },
  );

  const binding = await getBinding(statePath, "1001");
  assert.equal(binding?.threadId, "thread-a");
  assert.equal(binding?.threadLabel, "A");
  assert.equal(binding?.cwd, "D:\\alpha");
});

test("attach persists access state on the first binding write", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tg-bridge-bindings-"));
  const statePath = path.join(tempDir, "state.json");

  await ensureStateFile(statePath);
  await attachBinding(statePath, {
    chatId: "1001",
    threadId: "thread-a",
    threadLabel: "A",
    cwd: "D:\\alpha",
    access: {
      defaultApprovalPolicy: "never",
      defaultSandboxPolicy: { type: "dangerFullAccess" },
      overrideApprovalPolicy: null,
      overrideSandboxPolicy: null,
    },
  });

  const binding = await getBinding(statePath, "1001");
  assert.deepEqual(binding?.access, {
    defaultApprovalPolicy: "never",
    defaultSandboxPolicy: { type: "dangerFullAccess" },
    overrideApprovalPolicy: null,
    overrideSandboxPolicy: null,
  });
});

test("detach removes only the selected chat binding", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tg-bridge-bindings-"));
  const statePath = path.join(tempDir, "state.json");

  await ensureStateFile(statePath);
  await attachBinding(statePath, {
    chatId: "1001",
    threadId: "thread-a",
    threadLabel: "A",
    cwd: "D:\\alpha",
  });
  await attachBinding(statePath, {
    chatId: "1002",
    threadId: "thread-b",
    threadLabel: "B",
    cwd: "D:\\beta",
  });

  await detachBinding(statePath, "1001");

  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(state.activeBindings["1001"], undefined);
  assert.equal(state.activeBindings["1002"].threadId, "thread-b");
});

test("ensureStateFile creates the expected empty shape", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tg-bridge-bindings-"));
  const statePath = path.join(tempDir, "state.json");

  await ensureStateFile(statePath);

  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.deepEqual(state, createEmptyState());
});
