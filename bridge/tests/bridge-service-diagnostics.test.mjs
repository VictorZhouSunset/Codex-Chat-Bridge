// input: fake Telegram/Codex adapters, temporary state files, and bridge-local diagnostics commands
// output: verified /help, /status, /changes, and /last-error command behavior for Telegram users
// pos: concern-focused bridge runtime suite for diagnostics and operational introspection
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { BridgeService } from "../src/bridge-service.mjs";
import {
  createFakeCodexClient,
  createFakeTelegramApi,
  createInterruptibleQueuedCodexClient,
  createSessionAwareCodexClient,
  createTestStatePath,
  waitForNextTask,
} from "./helpers/bridge-service-fixtures.mjs";

test("slash help summarizes the supported Telegram bridge commands", async (t) => {
  const statePath = await createTestStatePath(t);
  const telegramApi = createFakeTelegramApi();
  const service = new BridgeService({
    statePath,
    codexClient: createFakeCodexClient(),
    telegramApi,
  });

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/help",
  });

  assert.equal(telegramApi.sent.length, 1);
  assert.match(telegramApi.sent[0].text, /\/status/);
  assert.match(telegramApi.sent[0].text, /\/changes/);
  assert.match(telegramApi.sent[0].text, /\/last-error/);
  assert.match(telegramApi.sent[0].text, /\/permission/);
  assert.match(telegramApi.sent[0].text, /\/interrupt/);
});

test("slash status reports binding, runtime, and access details", async (t) => {
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
    text: "/status",
  });

  assert.equal(telegramApi.sent.length, 1);
  assert.match(telegramApi.sent[0].text, /Bridge 状态: idle/);
  assert.match(telegramApi.sent[0].text, /项目: project-a/i);
  assert.match(telegramApi.sent[0].text, /当前线程: Project A/);
  assert.match(telegramApi.sent[0].text, /当前权限:/);
  assert.match(telegramApi.sent[0].text, /排队消息: 0/);
});

test("slash status reports the active relay runtime duration when a turn is in progress", async (t) => {
  const statePath = await createTestStatePath(t);
  const telegramApi = createFakeTelegramApi();
  const codexClient = createInterruptibleQueuedCodexClient();
  let nowMs = 10_000;
  const service = new BridgeService({
    statePath,
    codexClient,
    telegramApi,
    nowFn: () => nowMs,
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
  });

  const relay = await service.handleTelegramMessage({
    chatId: "1001",
    text: "still running",
  });
  await waitForNextTask();
  nowMs = 16_500;

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/status",
  });

  assert.match(telegramApi.sent.at(-1).text, /当前运行时长: 6s/);

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/interrupt",
  });
  await relay.completion;
});

test("slash status reports a degraded bridge session and the current attached-thread turn", async (t) => {
  const statePath = await createTestStatePath(t);
  const telegramApi = createFakeTelegramApi();
  const codexClient = createSessionAwareCodexClient({
    externalActiveTurn: {
      threadId: "thread-123",
      turnId: "turn-external",
    },
  });
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
    access: {
      defaultApprovalPolicy: "never",
      defaultSandboxPolicy: { type: "dangerFullAccess" },
      overrideApprovalPolicy: null,
      overrideSandboxPolicy: null,
    },
  });
  codexClient.clearAttachedThreadSession();

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/status",
  });

  assert.match(telegramApi.sent.at(-1)?.text ?? "", /Bridge 状态: degraded/);
  assert.match(telegramApi.sent.at(-1)?.text ?? "", /执行会话: degraded/);
  assert.match(telegramApi.sent.at(-1)?.text ?? "", /当前运行时长: 未知（已有 in-progress turn）/);
});

test("slash status includes the current running message preview for an attached-thread turn", async (t) => {
  const statePath = await createTestStatePath(t);
  const telegramApi = createFakeTelegramApi();
  const codexClient = createSessionAwareCodexClient({
    externalActiveTurn: {
      threadId: "thread-123",
      turnId: "turn-external",
      textPreview: "Unable to activate workspace 还是这么显示",
    },
  });
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

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/status",
  });

  assert.match(telegramApi.sent.at(-1)?.text ?? "", /当前运行消息: Unable to \.\.\./);
});

test("slash changes reports concise git-style workspace changes", async (t) => {
  const statePath = await createTestStatePath(t);
  const telegramApi = createFakeTelegramApi();
  const service = new BridgeService({
    statePath,
    codexClient: createFakeCodexClient(),
    telegramApi,
    readWorkspaceChanges: async (cwd) => {
      assert.equal(cwd, "D:\\project-a");
      return ["M src/app.tsx", "?? src/new-file.ts"];
    },
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
  });

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/changes",
  });

  assert.equal(telegramApi.sent.length, 1);
  assert.match(telegramApi.sent[0].text, /工作区变更/);
  assert.match(telegramApi.sent[0].text, /M src\/app\.tsx/);
  assert.match(telegramApi.sent[0].text, /\?\? src\/new-file\.ts/);
});

test("slash last-error reports the most recent relay failure for the chat", async (t) => {
  const statePath = await createTestStatePath(t);
  const telegramApi = createFakeTelegramApi();
  const service = new BridgeService({
    statePath,
    codexClient: {
      async readThread(threadId) {
        return {
          id: threadId,
          status: "idle",
        };
      },
      async relayText() {
        throw new Error("pnpm test failed");
      },
    },
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
    text: "run the tests",
  });
  await assert.rejects(relay.completion, /pnpm test failed/);

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/last-error",
  });

  assert.match(telegramApi.sent.at(-1).text, /最近错误/);
  assert.match(telegramApi.sent.at(-1).text, /pnpm test failed/);
});

test("slash last-error explains when no bridge error has been recorded", async (t) => {
  const statePath = await createTestStatePath(t);
  const telegramApi = createFakeTelegramApi();
  const service = new BridgeService({
    statePath,
    codexClient: createFakeCodexClient(),
    telegramApi,
  });

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/last-error",
  });

  assert.equal(telegramApi.sent.length, 1);
  assert.match(telegramApi.sent[0].text, /最近没有记录到 bridge 错误/);
});
