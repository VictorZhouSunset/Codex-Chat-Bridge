// input: fake Telegram/Codex adapters, temporary state files, and binding-level bridge commands
// output: verified attach, detach, relay, and permission behavior for the bridge runtime
// pos: concern-focused bridge runtime suite for binding and command flows
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { BridgeService } from "../src/bridge-service.mjs";
import {
  createFakeCodexClient,
  createFakeTelegramApi,
  createImmediateCodexClient,
  createTestStatePath,
} from "./helpers/bridge-service-fixtures.mjs";

test("attach stores the selected thread binding", async (t) => {
  const statePath = await createTestStatePath(t);
  const service = new BridgeService({
    statePath,
    codexClient: createFakeCodexClient(),
    telegramApi: createFakeTelegramApi(),
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
  });

  const status = await service.getStatus("1001");
  assert.equal(status.binding?.threadId, "thread-123");
  assert.equal(status.binding?.threadLabel, "Project A");
});

test("attach preserves access state on the stored binding", async (t) => {
  const statePath = await createTestStatePath(t);
  const service = new BridgeService({
    statePath,
    codexClient: createFakeCodexClient(),
    telegramApi: createFakeTelegramApi(),
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
    access: {
      defaultApprovalPolicy: "never",
      defaultSandboxPolicy: { type: "dangerFullAccess" },
      overrideApprovalPolicy: null,
      overrideSandboxPolicy: null,
    },
  });

  const status = await service.getStatus("1001");
  assert.deepEqual(status.binding?.access, {
    defaultApprovalPolicy: "never",
    defaultSandboxPolicy: { type: "dangerFullAccess" },
    overrideApprovalPolicy: null,
    overrideSandboxPolicy: null,
  });
});

test("relay sends normal telegram text to the bound Codex thread", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createFakeCodexClient();
  const telegramApi = createFakeTelegramApi();
  const service = new BridgeService({
    statePath,
    codexClient,
    telegramApi,
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
  });

  const relay = await service.handleTelegramMessage({
    chatId: "1001",
    text: "continue from telegram",
  });
  await relay.completion;

  assert.deepEqual(codexClient.relayCalls, [
    {
      threadId: "thread-123",
      text: "continue from telegram",
    },
  ]);
  assert.deepEqual(telegramApi.actions, [
    {
      chatId: "1001",
      action: "typing",
    },
  ]);
  assert.deepEqual(telegramApi.edited, []);
  assert.deepEqual(telegramApi.sent, [
    {
      chatId: "1001",
      text: "echo:continue from telegram",
      message_id: 1,
    },
  ]);
});

test("detach phrases clear the chat binding", async (t) => {
  const statePath = await createTestStatePath(t);
  const telegramApi = createFakeTelegramApi();
  const service = new BridgeService({
    statePath,
    codexClient: createFakeCodexClient(),
    telegramApi,
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
  });

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "回到 Codex",
  });

  const status = await service.getStatus("1001");
  assert.equal(status.binding, null);
  assert.deepEqual(telegramApi.sent, [
    {
      chatId: "1001",
      text: "Telegram relay detached. Continue in Codex or attach another thread later.",
      message_id: 1,
    },
  ]);
});

test("slash permission command updates the effective binding access", async (t) => {
  const statePath = await createTestStatePath(t);
  const telegramApi = createFakeTelegramApi();
  const service = new BridgeService({
    statePath,
    codexClient: createImmediateCodexClient(),
    telegramApi,
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
    access: {
      defaultApprovalPolicy: "never",
      defaultSandboxPolicy: { type: "dangerFullAccess" },
      overrideApprovalPolicy: null,
      overrideSandboxPolicy: null,
    },
  });

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/permission workspace",
  });

  const workspaceStatus = await service.getStatus("1001");
  assert.equal(workspaceStatus.binding?.access?.overrideApprovalPolicy, "on-request");
  assert.deepEqual(workspaceStatus.binding?.access?.overrideSandboxPolicy, {
    type: "workspaceWrite",
    writableRoots: ["D:\\project-a"],
    readOnlyAccess: { type: "fullAccess" },
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  });

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/permission default",
  });

  const defaultStatus = await service.getStatus("1001");
  assert.equal(defaultStatus.binding?.access?.overrideApprovalPolicy, null);
  assert.equal(defaultStatus.binding?.access?.overrideSandboxPolicy, null);
  assert.equal(
    telegramApi.sent.some(({ text }) => /权限已切换到 workspace/i.test(text)),
    true,
  );
});

test("slash permission without arguments sends an inline keyboard chooser", async (t) => {
  const statePath = await createTestStatePath(t);
  const telegramApi = createFakeTelegramApi();
  const service = new BridgeService({
    statePath,
    codexClient: createImmediateCodexClient(),
    telegramApi,
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
    access: {
      defaultApprovalPolicy: "on-request",
      defaultSandboxPolicy: {
        type: "readOnly",
        access: { type: "fullAccess" },
        networkAccess: false,
      },
      overrideApprovalPolicy: null,
      overrideSandboxPolicy: null,
    },
  });

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/permission",
  });

  assert.equal(telegramApi.sent.length, 1);
  assert.match(telegramApi.sent[0].text, /当前权限:/);
  assert.deepEqual(telegramApi.sent[0].reply_markup, {
    inline_keyboard: [
      [
        { text: "default", callback_data: "permission:default" },
        { text: "readonly", callback_data: "permission:readonly" },
      ],
      [
        { text: "workspace", callback_data: "permission:workspace" },
        { text: "full", callback_data: "permission:full" },
      ],
    ],
  });
});

test("permission callback payload updates the effective binding access", async (t) => {
  const statePath = await createTestStatePath(t);
  const telegramApi = createFakeTelegramApi();
  const service = new BridgeService({
    statePath,
    codexClient: createImmediateCodexClient(),
    telegramApi,
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
    access: {
      defaultApprovalPolicy: "on-request",
      defaultSandboxPolicy: {
        type: "readOnly",
        access: { type: "fullAccess" },
        networkAccess: false,
      },
      overrideApprovalPolicy: null,
      overrideSandboxPolicy: null,
    },
  });

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "permission:full",
  });

  const status = await service.getStatus("1001");
  assert.equal(status.binding?.access?.overrideApprovalPolicy, "never");
  assert.deepEqual(status.binding?.access?.overrideSandboxPolicy, {
    type: "dangerFullAccess",
  });
});
