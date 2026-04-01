// input: fake Telegram/Codex adapters, manual clocks, and slow relay progress sequences
// output: verified delayed progress visibility and throttled edit behavior for Telegram relay UX
// pos: concern-focused bridge runtime suite for typing and progress updates
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { BridgeService } from "../src/bridge-service.mjs";
import {
  createDelayedProgressCodexClient,
  createFakeTelegramApi,
  createManualClock,
  createTestStatePath,
  createThrottledCodexClient,
  waitForNextTask,
} from "./helpers/bridge-service-fixtures.mjs";

test("collapses buffered progress into a single delayed progress message before fast completion", { concurrency: false }, async (t) => {
  const statePath = await createTestStatePath(t);
  const clock = createManualClock();
  const realDateNow = Date.now;
  Date.now = () => clock.now();
  t.after(() => {
    Date.now = realDateNow;
  });

  const telegramApi = createFakeTelegramApi();
  const codexClient = createThrottledCodexClient();
  const service = new BridgeService({
    statePath,
    codexClient,
    telegramApi,
    initialProgressDelayMs: 1_000,
    progressEditIntervalMs: 1_000,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
  });

  const relay = await service.handleTelegramMessage({
    chatId: "1001",
    text: "throttle me",
  });

  await waitForNextTask();
  await clock.advance(1_000);
  await waitForNextTask();
  codexClient.releaseRelay();
  await relay.completion;

  assert.deepEqual(telegramApi.edited, []);
  assert.deepEqual(telegramApi.sent, [
    {
      chatId: "1001",
      text: "正在调用工具: playwright.browser_click\n（持续工作中）",
      message_id: 1,
    },
    {
      chatId: "1001",
      text: "echo:throttle me",
      message_id: 2,
    },
  ]);
});

test("delays the first visible progress update so typing can appear before slow replies", { concurrency: false }, async (t) => {
  const statePath = await createTestStatePath(t);
  const clock = createManualClock();
  const realDateNow = Date.now;
  Date.now = () => clock.now();
  t.after(() => {
    Date.now = realDateNow;
  });

  const telegramApi = createFakeTelegramApi();
  const codexClient = createDelayedProgressCodexClient();
  const service = new BridgeService({
    statePath,
    codexClient,
    telegramApi,
    initialProgressDelayMs: 1_000,
    progressEditIntervalMs: 1_000,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
  });

  const relay = await service.handleTelegramMessage({
    chatId: "1001",
    text: "slow reply please",
  });

  await waitForNextTask();
  assert.deepEqual(telegramApi.actions, [
    {
      chatId: "1001",
      action: "typing",
    },
  ]);
  assert.deepEqual(telegramApi.sent, []);

  await clock.advance(1_000);
  assert.deepEqual(telegramApi.sent, [
    {
      chatId: "1001",
      text: "正在读取 thread\n（持续工作中）",
      message_id: 1,
    },
  ]);

  codexClient.releaseSecondProgress();
  await waitForNextTask();
  await clock.advance(1_000);
  assert.deepEqual(telegramApi.edited, [
    {
      chatId: "1001",
      messageId: 1,
      text: "正在运行命令: pnpm test\n（持续工作中）",
    },
  ]);

  codexClient.releaseRelay();
  await relay.completion;
  assert.deepEqual(telegramApi.sent, [
    {
      chatId: "1001",
      text: "正在读取 thread\n（持续工作中）",
      message_id: 1,
    },
    {
      chatId: "1001",
      text: "echo:slow reply please",
      message_id: 2,
    },
  ]);
});
