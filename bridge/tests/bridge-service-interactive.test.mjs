// input: fake Telegram/Codex adapters and interactive approval or question prompt sequences
// output: verified Telegram-to-Codex prompt reply routing and interactive queue behavior
// pos: concern-focused bridge runtime suite for approvals and request_user_input flows
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { BridgeService } from "../src/bridge-service.mjs";
import {
  createApprovalOnlyPromptCodexClient,
  createDoubleApprovalPromptCodexClient,
  createFakeTelegramApi,
  createInteractivePromptCodexClient,
  createTestStatePath,
  waitForNextTask,
} from "./helpers/bridge-service-fixtures.mjs";

test("routes Telegram approval replies into interactive command approval requests", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createApprovalOnlyPromptCodexClient();
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
    text: "continue with approvals",
  });

  await waitForNextTask();
  assert.equal(
    telegramApi.sent.some(({ text }) => /approve|deny|pnpm test/i.test(text)),
    true,
  );

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "approve",
  });

  await assert.doesNotReject(() => codexClient.waitForApprovalResponse());
  assert.deepEqual(await codexClient.waitForApprovalResponse(), {
    decision: "accept",
  });
  await relay.completion;
});

test("routes Telegram question answers into request_user_input responses", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createInteractivePromptCodexClient();
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
    text: "continue with questions",
  });

  await waitForNextTask();
  await service.handleTelegramMessage({
    chatId: "1001",
    text: "approve",
  });
  await codexClient.waitForApprovalResponse();

  assert.equal(
    telegramApi.sent.some(({ text }) => /Pick a tone|1\.|Friendly/i.test(text)),
    true,
  );

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "2",
  });
  assert.equal(
    telegramApi.sent.some(({ text }) => /Add a short note/i.test(text)),
    true,
  );

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "Ship it",
  });

  assert.deepEqual(await codexClient.waitForUserInputResponse(), {
    answers: {
      tone: { answers: ["Friendly"] },
      note: { answers: ["Ship it"] },
    },
  });
  await relay.completion;
});

test("queues multiple interactive approvals for the same chat instead of overwriting the first one", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createDoubleApprovalPromptCodexClient();
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
    text: "continue with two approvals",
  });

  await waitForNextTask();
  assert.equal(
    telegramApi.sent.some(({ text }) => /pnpm test/i.test(text)),
    true,
  );

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "approve",
  });

  assert.deepEqual(await codexClient.waitForFirstApprovalResponse(), {
    decision: "accept",
  });

  assert.equal(
    telegramApi.sent.some(({ text }) => /cargo test/i.test(text)),
    true,
  );

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "approve",
  });

  assert.deepEqual(await codexClient.waitForSecondApprovalResponse(), {
    decision: "accept",
  });

  await assert.doesNotReject(() => relay.completion);
});

test("slash detach takes effect even while an interactive prompt is pending", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createApprovalOnlyPromptCodexClient();
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
    text: "continue with approvals",
  });

  await waitForNextTask();
  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/detach",
  });

  const status = await service.getStatus("1001");
  assert.equal(status.binding, null);
  assert.equal(
    telegramApi.sent.some(({ text }) => /Telegram relay detached/i.test(text)),
    true,
  );
  await relay.completion;
});
