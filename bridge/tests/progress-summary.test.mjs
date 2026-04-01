import test from "node:test";
import assert from "node:assert/strict";

import {
  formatProgressText,
  summarizeThreadItem,
} from "../src/progress-summary.mjs";

test("summarizeThreadItem formats command execution succinctly", () => {
  const summary = summarizeThreadItem({
    type: "commandExecution",
    command: "pnpm test --filter @mycontent/desktop",
  });

  assert.equal(summary, "运行命令: pnpm test --filter @mycontent/desktop");
});

test("summarizeThreadItem formats tool calls succinctly", () => {
  const summary = summarizeThreadItem({
    type: "mcpToolCall",
    server: "playwright",
    tool: "browser_click",
  });

  assert.equal(summary, "调用工具: playwright.browser_click");
});

test("formatProgressText handles a single active action", () => {
  const text = formatProgressText([
    "运行命令: pnpm test",
  ]);

  assert.equal(text, "正在运行命令: pnpm test\n（持续工作中）");
});

test("formatProgressText handles multiple active actions", () => {
  const text = formatProgressText([
    "运行命令: pnpm test",
    "调用工具: playwright.browser_click",
    "修改文件",
  ]);

  assert.equal(text, "正在运行命令: pnpm test，以及其他 2 个动作\n（持续工作中）");
});
