// input: fake Codex app-server processes that emit started and completed item notifications
// output: verified progress aggregation output while a turn is still running
// pos: concern-focused app-server client suite for progress event handling
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { CodexAppServerClient } from "../src/codex-app-server.mjs";
import { createProgressFakeCodexProcess } from "./helpers/codex-app-server-fixtures.mjs";

test("emits aggregated progress updates while a turn is in progress", async () => {
  const progress = [];
  const client = new CodexAppServerClient({
    processFactory: () => createProgressFakeCodexProcess(),
  });

  await client.start();
  const result = await client.relayText({
    threadId: "thread-progress",
    text: "continue",
    onProgress: async (text) => {
      progress.push(text);
    },
  });

  assert.equal(result.text, "Done");
  assert.deepEqual(progress, [
    "正在运行命令: pnpm test\n（持续工作中）",
    "正在运行命令: pnpm test，以及其他 1 个动作\n（持续工作中）",
    "正在调用工具: playwright.browser_click\n（持续工作中）",
  ]);

  await client.close();
});
