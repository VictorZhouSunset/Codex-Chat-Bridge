// input: app-server protocol messages and sandbox policy overrides
// output: verified protocol normalization and sandbox mode translation behavior
// pos: unit test for Codex app-server protocol helper functions
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import {
  getItemId,
  normalizeServerRequest,
  toSandboxMode,
} from "../src/codex-app-server-protocol.mjs";

test("normalizeServerRequest maps command approval requests", () => {
  const request = normalizeServerRequest({
    id: "request-1",
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      command: "pnpm test",
      cwd: "D:\\project",
      reason: "Need approval",
      availableDecisions: ["accept", "decline"],
    },
  });

  assert.deepEqual(request, {
    kind: "command_approval",
    requestId: "request-1",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    approvalId: null,
    reason: "Need approval",
    command: "pnpm test",
    cwd: "D:\\project",
    availableDecisions: ["accept", "decline"],
  });
});

test("normalizeServerRequest maps file-change and user-input requests", () => {
  assert.deepEqual(
    normalizeServerRequest({
      id: "request-2",
      method: "item/fileChange/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-2",
        reason: "Need write approval",
        grantRoot: "D:\\project",
      },
    }),
    {
      kind: "file_change_approval",
      requestId: "request-2",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-2",
      reason: "Need write approval",
      grantRoot: "D:\\project",
    },
  );

  assert.deepEqual(
    normalizeServerRequest({
      id: "request-3",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-3",
        questions: [{ id: "tone", question: "Pick tone" }],
      },
    }),
    {
      kind: "user_input",
      requestId: "request-3",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-3",
      questions: [{ id: "tone", question: "Pick tone" }],
    },
  );
});

test("toSandboxMode maps supported sandbox policy shapes", () => {
  assert.equal(toSandboxMode("read-only"), "read-only");
  assert.equal(toSandboxMode({ type: "dangerFullAccess" }), "danger-full-access");
  assert.equal(toSandboxMode({ type: "readOnly" }), "read-only");
  assert.equal(toSandboxMode({ type: "workspaceWrite" }), "workspace-write");
});

test("toSandboxMode rejects unknown sandbox policy types", () => {
  assert.throws(
    () => toSandboxMode({ type: "customSandbox" }),
    /Unsupported sandbox policy type/i,
  );
});

test("getItemId prefers params.itemId and falls back to item.id", () => {
  assert.equal(getItemId({ itemId: "item-1", item: { id: "item-2" } }), "item-1");
  assert.equal(getItemId({ item: { id: "item-2" } }), "item-2");
  assert.equal(getItemId({}), null);
});
