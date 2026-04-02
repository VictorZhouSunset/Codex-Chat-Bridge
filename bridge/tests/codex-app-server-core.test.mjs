// input: fake Codex app-server processes for initialization, thread reads, and relay startup
// output: verified client lifecycle behavior and basic text relay handling
// pos: concern-focused app-server client suite for core lifecycle and turn startup
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { CodexAppServerClient } from "../src/codex-app-server.mjs";
import {
  createFakeCodexProcess,
  createResumeRequiredFakeCodexProcess,
  createResumeRequiredInterruptFakeCodexProcess,
} from "./helpers/codex-app-server-fixtures.mjs";

test("initializes the app-server client and reads a thread", async () => {
  const client = new CodexAppServerClient({
    processFactory: () => createFakeCodexProcess(),
  });

  await client.start();
  const thread = await client.readThread("thread-123");

  assert.equal(thread.id, "thread-123");
  assert.equal(thread.name, "Fake");

  await client.close();
});

test("aggregates agent deltas until turn completion", async () => {
  const client = new CodexAppServerClient({
    processFactory: () => createFakeCodexProcess(),
  });

  await client.start();
  await client.attachThreadSession({
    threadId: "thread-123",
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
  });
  const result = await client.relayText({
    threadId: "thread-123",
    text: "continue",
  });

  assert.equal(result.threadId, "thread-123");
  assert.equal(result.turnId, "turn-1");
  assert.equal(result.text, "Hello world");

  await client.close();
});

test("resumes a thread before starting a turn when the app-server requires it", async () => {
  let fakeProcess;
  const client = new CodexAppServerClient({
    processFactory: () => {
      fakeProcess = createResumeRequiredFakeCodexProcess();
      return fakeProcess;
    },
  });

  await client.start();
  await client.attachThreadSession({
    threadId: "thread-xyz",
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
  });
  const result = await client.relayText({
    threadId: "thread-xyz",
    text: "continue",
  });

  assert.equal(result.text, "Resumed ok");
  assert.deepEqual(fakeProcess.getSeenMethods(), [
    "initialize",
    "thread/resume",
    "turn/start",
  ]);

  await client.close();
});

test("resumes a thread before interrupting a turn when the app-server requires it", async () => {
  let fakeProcess;
  const client = new CodexAppServerClient({
    processFactory: () => {
      fakeProcess = createResumeRequiredInterruptFakeCodexProcess();
      return fakeProcess;
    },
  });

  await client.start();
  await client.attachThreadSession({
    threadId: "thread-xyz",
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
  });
  const activeTurn = await client.inspectActiveTurn("thread-xyz");
  const result = await client.interruptTurn({
    threadId: "thread-xyz",
    turnId: activeTurn.id,
  });

  assert.equal(result.interrupted, true);
  assert.deepEqual(fakeProcess.getSeenMethods(), [
    "initialize",
    "thread/resume",
    "thread/read",
    "turn/interrupt",
  ]);

  await client.close();
});

test("attaches a thread session once and reuses it for relay plus interrupt", async () => {
  let fakeProcess;
  const client = new CodexAppServerClient({
    processFactory: () => {
      fakeProcess = createResumeRequiredInterruptFakeCodexProcess();
      return fakeProcess;
    },
  });

  await client.start();
  await client.attachThreadSession({
    threadId: "thread-xyz",
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
    cwd: "D:\\project-a",
  });

  const relayResult = await client.relayText({
    threadId: "thread-xyz",
    text: "hello",
  });
  await client.interruptTurn({
    threadId: "thread-xyz",
    turnId: "turn-interrupt",
  });

  assert.equal(relayResult.turnId, "turn-started");
  assert.deepEqual(fakeProcess.getSeenMethods(), [
    "initialize",
    "thread/resume",
    "turn/start",
    "turn/interrupt",
  ]);

  await client.close();
});
