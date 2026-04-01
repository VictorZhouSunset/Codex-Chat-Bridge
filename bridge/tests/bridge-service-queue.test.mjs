// input: fake Telegram/Codex adapters, busy-thread states, and queued relay requests
// output: verified queueing and message ordering behavior for bridge runtime relays
// pos: concern-focused bridge runtime suite for queue management
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { BridgeService } from "../src/bridge-service.mjs";
import {
  createFakeCodexClient,
  createFakeTelegramApi,
  createQueuedCodexClient,
  createTestStatePath,
} from "./helpers/bridge-service-fixtures.mjs";

test("queues a telegram message when the bound thread is already in progress", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createFakeCodexClient();
  codexClient.threadStatus = "inProgress";
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
    text: "another message",
  });

  assert.deepEqual(codexClient.relayCalls, []);
  assert.deepEqual(telegramApi.sent, [
    {
      chatId: "1001",
      text: "（codex还在运行上一个turn，结束后消息会送达codex）",
      message_id: 1,
    },
  ]);
  codexClient.threadStatus = "idle";
  await relay.completion;
  assert.deepEqual(codexClient.relayCalls, [
    {
      threadId: "thread-123",
      text: "another message",
    },
  ]);
});

test("queues a second telegram message behind an active relay", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createQueuedCodexClient();
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

  const first = await service.handleTelegramMessage({
    chatId: "1001",
    text: "first",
  });
  const second = await service.handleTelegramMessage({
    chatId: "1001",
    text: "second",
  });

  assert.deepEqual(telegramApi.sent, [
    {
      chatId: "1001",
      text: "（codex还在运行上一个turn，结束后消息会送达codex）",
      message_id: 1,
    },
  ]);

  codexClient.releaseFirstRelay();
  await first.completion;
  await second.completion;

  assert.deepEqual(codexClient.relayCalls, [
    {
      threadId: "thread-123",
      text: "first",
    },
    {
      threadId: "thread-123",
      text: "second",
    },
  ]);
  assert.deepEqual(telegramApi.actions, [
    {
      chatId: "1001",
      action: "typing",
    },
    {
      chatId: "1001",
      action: "typing",
    },
  ]);
  assert.deepEqual(telegramApi.sent, [
    {
      chatId: "1001",
      text: "（codex还在运行上一个turn，结束后消息会送达codex）",
      message_id: 1,
    },
    {
      chatId: "1001",
      text: "echo:first",
      message_id: 2,
    },
    {
      chatId: "1001",
      text: "echo:second",
      message_id: 3,
    },
  ]);
});
