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
