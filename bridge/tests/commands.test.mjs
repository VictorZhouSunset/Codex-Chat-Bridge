import test from "node:test";
import assert from "node:assert/strict";

import { classifyTelegramText } from "../src/commands.mjs";

test("recognizes english detach phrases", () => {
  assert.deepEqual(classifyTelegramText("detach"), {
    kind: "detach",
    normalizedText: "detach",
  });
  assert.deepEqual(classifyTelegramText("stop"), {
    kind: "detach",
    normalizedText: "stop",
  });
});

test("recognizes slash cancel and slash detach commands", () => {
  assert.deepEqual(classifyTelegramText("/cancel"), {
    kind: "cancel",
    normalizedText: "/cancel",
  });
  assert.deepEqual(classifyTelegramText("/interrupt"), {
    kind: "interrupt",
    normalizedText: "/interrupt",
  });
  assert.deepEqual(classifyTelegramText("/detach"), {
    kind: "detach",
    normalizedText: "/detach",
  });
});

test("recognizes diagnostic slash commands", () => {
  assert.deepEqual(classifyTelegramText("/help"), {
    kind: "help",
    normalizedText: "/help",
  });
  assert.deepEqual(classifyTelegramText("/status"), {
    kind: "status",
    normalizedText: "/status",
  });
  assert.deepEqual(classifyTelegramText("/changes"), {
    kind: "changes",
    normalizedText: "/changes",
  });
  assert.deepEqual(classifyTelegramText("/last-error"), {
    kind: "last-error",
    normalizedText: "/last-error",
  });
});

test("recognizes permission commands", () => {
  assert.deepEqual(classifyTelegramText("/permission full"), {
    kind: "permission",
    normalizedText: "/permission full",
    permissionLevel: "full",
  });
  assert.deepEqual(classifyTelegramText("/permission"), {
    kind: "permission",
    normalizedText: "/permission",
    permissionLevel: null,
  });
});

test("recognizes permission callback payloads", () => {
  assert.deepEqual(classifyTelegramText("permission:workspace"), {
    kind: "permission",
    normalizedText: "permission:workspace",
    permissionLevel: "workspace",
  });
});

test("recognizes chinese detach phrases", () => {
  assert.deepEqual(classifyTelegramText("回到 Codex"), {
    kind: "detach",
    normalizedText: "回到 codex",
  });
  assert.deepEqual(classifyTelegramText("结束 Telegram 接管"), {
    kind: "detach",
    normalizedText: "结束 telegram 接管",
  });
});

test("classifies normal text as relay input", () => {
  assert.deepEqual(classifyTelegramText("Please continue the refactor."), {
    kind: "relay",
    normalizedText: "please continue the refactor.",
  });
});
