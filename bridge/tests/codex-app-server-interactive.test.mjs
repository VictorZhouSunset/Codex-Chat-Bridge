// input: fake Codex app-server processes that emit approval and request_user_input server requests
// output: verified interactive callback routing back into the app-server JSON-RPC flow
// pos: concern-focused app-server client suite for interactive requests
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { CodexAppServerClient } from "../src/codex-app-server.mjs";
import {
  createApprovalRequestFakeCodexProcess,
  createUserInputRequestFakeCodexProcess,
} from "./helpers/codex-app-server-fixtures.mjs";

test("answers command approval requests through the interactive callback", async () => {
  let fakeProcess;
  const interactiveRequests = [];
  const client = new CodexAppServerClient({
    processFactory: () => {
      fakeProcess = createApprovalRequestFakeCodexProcess();
      return fakeProcess;
    },
  });

  await client.start();
  const result = await client.relayText({
    threadId: "thread-approval",
    text: "continue",
    onInteractiveRequest: async (request) => {
      interactiveRequests.push(request);
      return { decision: "accept" };
    },
  });

  assert.equal(result.text, "Approved and continued");
  assert.equal(interactiveRequests[0].kind, "command_approval");
  assert.deepEqual(fakeProcess.getCapturedApprovalResult(), {
    decision: "accept",
  });

  await client.close();
});

test("answers request_user_input prompts through the interactive callback", async () => {
  let fakeProcess;
  const interactiveRequests = [];
  const client = new CodexAppServerClient({
    processFactory: () => {
      fakeProcess = createUserInputRequestFakeCodexProcess();
      return fakeProcess;
    },
  });

  await client.start();
  const result = await client.relayText({
    threadId: "thread-user-input",
    text: "continue",
    onInteractiveRequest: async (request) => {
      interactiveRequests.push(request);
      return {
        answers: {
          tone: { answers: ["Friendly"] },
          note: { answers: ["Ship it"] },
        },
      };
    },
  });

  assert.equal(result.text, "Collected input");
  assert.equal(interactiveRequests[0].kind, "user_input");
  assert.deepEqual(fakeProcess.getCapturedUserInputResult(), {
    answers: {
      tone: { answers: ["Friendly"] },
      note: { answers: ["Ship it"] },
    },
  });

  await client.close();
});
