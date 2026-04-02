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
  createFailingAttachCodexClient,
  createFakeTelegramApi,
  createImmediateCodexClient,
  createInterruptibleQueuedCodexClient,
  createQueuedCodexClient,
  createReadThreadFailsDuringWorkerCodexClient,
  createSessionAwareCodexClient,
  createTestStatePath,
  waitForNextTask,
} from "./helpers/bridge-service-fixtures.mjs";

test("attach only persists a binding after the app-server session is prepared", async (t) => {
  const statePath = await createTestStatePath(t);
  const service = new BridgeService({
    statePath,
    codexClient: createFailingAttachCodexClient(),
    telegramApi: createFakeTelegramApi(),
  });

  await assert.rejects(
    service.attach({
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
    }),
    /attach session failed/i,
  );

  const state = await readState(statePath);
  assert.deepEqual(state.activeBindings, {});
});

test("same-thread attach is idempotent once the bridge session is already ready", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createSessionAwareCodexClient();
  const service = new BridgeService({
    statePath,
    codexClient,
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

  assert.equal(codexClient.attachedSessions.length, 1);
});

test("attaching a different thread still preserves the detach-first conflict guard", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createSessionAwareCodexClient();
  const service = new BridgeService({
    statePath,
    codexClient,
    telegramApi: createFakeTelegramApi(),
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
  });

  await assert.rejects(
    service.attach({
      chatId: "2002",
      threadId: "thread-456",
      threadLabel: "Project B",
      cwd: "D:\\project-b",
    }),
    (error) => {
      assert.equal(error?.code, "BINDING_CONFLICT");
      assert.match(error?.message ?? "", /detach/i);
      return true;
    },
  );

  const state = await readState(statePath);
  assert.deepEqual(Object.keys(state.activeBindings), ["1001"]);
  assert.equal(codexClient.attachedSessions.length, 1);
});

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

test("shutdown drops a job that is only waiting on an attached-thread in-progress turn", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createSessionAwareCodexClient({
    externalActiveTurn: {
      threadId: "thread-123",
      turnId: "turn-external",
    },
  });
  let releaseWait;
  const waitGate = new Promise((resolve) => {
    releaseWait = resolve;
  });
  const telegramApi = createFakeTelegramApi();
  const service = new BridgeService({
    statePath,
    codexClient,
    telegramApi,
    threadPollIntervalMs: 0,
    waitFn: async () => {
      await waitGate;
    },
  });

  await service.attach({
    chatId: "1001",
    threadId: "thread-123",
    threadLabel: "Project A",
    cwd: "D:\\project-a",
  });

  const relay = await service.handleTelegramMessage({
    chatId: "1001",
    text: "queued-behind-external",
  });
  await waitForNextTask();
  await service.requestShutdown?.("tray");
  codexClient.clearExternalActiveTurn();
  releaseWait();

  const result = await relay.completion;

  assert.deepEqual(result, { dropped: true });
  assert.deepEqual(codexClient.relayCalls, []);
  assert.equal(
    telegramApi.sent.some(({ text }) => text === "echo:queued-behind-external"),
    false,
  );
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
  assert.equal(codexClient.relayCalls.length, 1);
  assert.equal(
    telegramApi.sent.some(({ text }) => /Telegram relay error: thread lookup failed/i.test(text)),
    true,
  );
});

test("slash interrupt stops the active turn and drops queued jobs for the chat", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createInterruptibleQueuedCodexClient();
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
  await waitForNextTask();

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/interrupt",
  });

  await first.completion;
  await second.completion;

  assert.deepEqual(codexClient.interrupts, [
    {
      threadId: "thread-123",
      turnId: "turn-interruptible",
    },
  ]);
  assert.equal(
    telegramApi.sent.some(({ text }) => /已中断当前运行中的 turn/i.test(text)),
    true,
  );

  const runtime = await service.getRuntimeStatus();
  assert.equal(runtime.mode, "idle");
  assert.equal(runtime.queueDepth, 0);
});

test("slash interrupt on a degraded session tells the user to re-attach instead of attempting recovery", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createSessionAwareCodexClient();
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
    text: "/interrupt",
  });

  assert.equal(codexClient.interrupts.length, 0);
  assert.match(
    telegramApi.sent.at(-1)?.text ?? "",
    /bridge 会话未就绪|重新 attach/i,
  );
});

test("slash interrupt can stop an attached-thread turn even when the current process did not start it", async (t) => {
  const statePath = await createTestStatePath(t);
  const codexClient = createSessionAwareCodexClient({
    externalActiveTurn: {
      threadId: "thread-123",
      turnId: "turn-external",
    },
  });
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

  await service.handleTelegramMessage({
    chatId: "1001",
    text: "/interrupt",
  });

  assert.deepEqual(codexClient.interrupts, [
    {
      threadId: "thread-123",
      turnId: "turn-external",
    },
  ]);
  assert.match(telegramApi.sent.at(-1)?.text ?? "", /已中断当前运行中的 turn/i);
});
