// input: fake Telegram/Codex adapters and lifecycle events such as shutdown, draining, detach, and worker failure
// output: verified bridge runtime exit intent, draining behavior, and job settlement guarantees
// pos: concern-focused bridge runtime suite for shutdown and lifecycle orchestration
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { BridgeService } from "../src/bridge-service.mjs";
import { readState } from "../src/binding-store.mjs";
import {
  createBlockingFirstSendTelegramApi,
  createBlockingNthSendTelegramApi,
  createFailingShutdownTelegramApi,
  createFakeTelegramApi,
  createImmediateCodexClient,
  createQueuedCodexClient,
  createReadThreadFailsDuringWorkerCodexClient,
  createTestStatePath,
} from "./helpers/bridge-service-fixtures.mjs";

test("requesting shutdown while idle marks the bridge ready to stop immediately", async (t) => {
  const statePath = await createTestStatePath(t);
  const service = new BridgeService({
    statePath,
    codexClient: createImmediateCodexClient(),
    telegramApi: createFakeTelegramApi(),
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
  });

  await service.requestShutdown?.("tray");

  const runtime = await service.getRuntimeStatus?.();
  assert.equal(runtime?.mode, "ready_to_stop");
  assert.equal(runtime?.shutdownRequested, true);
  assert.equal(runtime?.shutdownSource, "tray");
  assert.equal(runtime?.shouldExit, true);

  const state = await readState(statePath);
  assert.deepEqual(state.activeBindings, {});
});

test("requesting shutdown while busy changes the mode to draining and drops queued jobs", async (t) => {
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

  await service.requestShutdown?.("tray");
  const drainingRuntime = await service.getRuntimeStatus?.();
  assert.equal(drainingRuntime?.mode, "draining");
  assert.equal(drainingRuntime?.shutdownSource, "tray");
  codexClient.releaseFirstRelay();
  await first.completion;
  await second.completion;

  const runtime = await service.getRuntimeStatus?.();
  assert.equal(runtime?.mode, "ready_to_stop");
  assert.deepEqual(codexClient.relayCalls, [
    {
      threadId: "thread-123",
      text: "first",
    },
  ]);

  const state = await readState(statePath);
  assert.deepEqual(state.activeBindings, {});
});

test("new Telegram input during draining gets a rejection message", async (t) => {
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
    text: "busy first",
  });
  await service.requestShutdown?.("tray");

  const relay = await service.handleTelegramMessage({
    chatId: "1001",
    text: "still there?",
  });
  codexClient.releaseFirstRelay();
  await first.completion;
  await relay.completion;

  const rejectionMessage = telegramApi.sent.find(({ text }) => /drain|reject|shutdown/i.test(text));
  assert.match(rejectionMessage?.text ?? "", /drain|reject|shutdown/i);
  assert.match(rejectionMessage?.text ?? "", /tray/i);
});

test("detaching the last binding triggers auto-exit intent", async (t) => {
  const statePath = await createTestStatePath(t);
  const service = new BridgeService({
    statePath,
    codexClient: createImmediateCodexClient(),
    telegramApi: createFakeTelegramApi(),
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
  });

  await service.detach("1001");

  const status = await service.getStatus("1001");
  assert.equal(status.binding, null);

  const runtime = await service.getRuntimeStatus?.();
  assert.equal(runtime?.shouldExit, true);
});

test("shutdown requested after a relay has started lets the active job finish", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createImmediateCodexClient();
  const telegramApi = createBlockingFirstSendTelegramApi();
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

  const relayPromise = service.handleTelegramMessage({
    chatId: "1001",
    text: "race me",
  });

  await telegramApi.firstSendStarted;
  await service.requestShutdown?.();
  telegramApi.releaseFirstSend();

  const relay = await relayPromise;
  await relay.completion;

  assert.equal(codexClient.relayCalls.length, 1);
  assert.equal(codexClient.relayCalls[0].text, "race me");
  assert.equal(
    telegramApi.sent.some(({ text }) => text === "echo:race me"),
    true,
  );
});

test("shutdown requested while a queued notice is mid-flight does not restart work", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createQueuedCodexClient();
  const telegramApi = createBlockingNthSendTelegramApi(2);
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
  const secondPromise = service.handleTelegramMessage({
    chatId: "1001",
    text: "second",
  });

  await telegramApi.blockedSendStarted;
  await service.requestShutdown?.();
  telegramApi.releaseBlockedSend();

  const second = await secondPromise;
  codexClient.releaseFirstRelay();
  await first.completion;
  await second.completion;

  assert.deepEqual(codexClient.relayCalls, [
    {
      threadId: "thread-123",
      text: "first",
    },
  ]);
});

test("detaching with queued work settles queued completions instead of orphaning them", async (t) => {
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

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "回到 Codex",
  });
  codexClient.releaseFirstRelay();
  await first.completion;

  const secondResult = await Promise.race([
    second.completion.then(() => "settled"),
    new Promise((resolve) => {
      setTimeout(() => resolve("timeout"), 100);
    }),
  ]);

  assert.equal(secondResult, "settled");
  assert.deepEqual(codexClient.relayCalls, [
    {
      threadId: "thread-123",
      text: "first",
    },
  ]);
  assert.equal(
    telegramApi.sent.some(({ text }) => text === "echo:second"),
    false,
  );
});

test("shutdown still settles queued jobs when the shutdown notification send fails", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createQueuedCodexClient();
  const telegramApi = createFailingShutdownTelegramApi();
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

  await service.requestShutdown?.();
  codexClient.releaseFirstRelay();
  await first.completion;

  const secondResult = await Promise.race([
    second.completion.then(() => "settled"),
    new Promise((resolve) => {
      setTimeout(() => resolve("timeout"), 100);
    }),
  ]);

  assert.equal(secondResult, "settled");
});

test("worker preflight failures settle the job instead of orphaning its completion", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createReadThreadFailsDuringWorkerCodexClient();
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
    text: "fail during worker preflight",
  });

  await assert.rejects(relay.completion, /thread lookup failed/i);
  assert.equal(codexClient.relayCalls.length, 0);
  assert.equal(
    telegramApi.sent.some(({ text }) => /Telegram relay error: thread lookup failed/i.test(text)),
    true,
  );
});
