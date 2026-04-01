// input: raw CLI args, config objects, and chat ids
// output: verified parsing and config helper behavior for the bridge CLI
// pos: unit test for extracted CLI helper functions
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUsageText,
  getControlPort,
  isAllowedChat,
  parseArgs,
  resolveAttachInputs,
} from "../src/cli-support.mjs";

test("parseArgs extracts flag-value pairs and ignores bare tokens", () => {
  assert.deepEqual(
    parseArgs(["attach", "--chat-id", "1001", "--thread-id", "thread-1", "ignored"]),
    {
      "chat-id": "1001",
      "thread-id": "thread-1",
    },
  );
});

test("getControlPort falls back to the default port", () => {
  assert.equal(getControlPort({ controlPort: 49000 }), 49000);
  assert.equal(getControlPort({}), 47821);
});

test("isAllowedChat matches allowed chat ids as strings", () => {
  assert.equal(isAllowedChat({ allowedChatIds: [1001, "1002"] }, "1001"), true);
  assert.equal(isAllowedChat({ allowedChatIds: [1001, "1002"] }, "9999"), false);
  assert.equal(isAllowedChat({ allowedChatIds: [] }, "1001"), false);
});

test("buildUsageText lists the supported CLI commands", () => {
  const usageText = buildUsageText();

  assert.match(usageText, /init-config/i);
  assert.match(usageText, /attach/i);
  assert.match(usageText, /serve/i);
});

test("resolveAttachInputs prefers args and validates both chat and thread ids", () => {
  assert.deepEqual(
    resolveAttachInputs({
      args: {
        "chat-id": "1001",
        "thread-id": "thread-1",
      },
      config: {
        defaultChatId: "fallback-chat",
      },
      env: {
        CODEX_THREAD_ID: "fallback-thread",
      },
    }),
    {
      chatId: "1001",
      threadId: "thread-1",
    },
  );

  assert.throws(
    () =>
      resolveAttachInputs({
        args: {},
        config: {},
        env: {},
      }),
    /attach requires --chat-id or config\.defaultChatId\./i,
  );

  assert.throws(
    () =>
      resolveAttachInputs({
        args: {
          "chat-id": "1001",
        },
        config: {},
        env: {},
      }),
    /attach requires --thread-id or CODEX_THREAD_ID\./i,
  );
});
