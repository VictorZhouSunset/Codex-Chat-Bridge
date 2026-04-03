import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAttachReadyMessage,
  buildBlockingTurnNotice,
  shouldSendAttachReadyMessage,
} from "../src/attach-notification.mjs";

test("sends an attach-ready message for a fresh binding", () => {
  assert.equal(
    shouldSendAttachReadyMessage({
      existingBinding: null,
      targetThreadId: "thread-123",
      wasHealthy: true,
    }),
    true,
  );
});

test("sends an attach-ready message when recovering an unhealthy daemon for the same thread", () => {
  assert.equal(
    shouldSendAttachReadyMessage({
      existingBinding: {
        chatId: "1001",
        threadId: "thread-123",
      },
      targetThreadId: "thread-123",
      wasHealthy: false,
    }),
    true,
  );
});

test("does not resend the attach-ready message for an already healthy same-thread binding", () => {
  assert.equal(
    shouldSendAttachReadyMessage({
      existingBinding: {
        chatId: "1001",
        threadId: "thread-123",
      },
      targetThreadId: "thread-123",
      wasHealthy: true,
    }),
    false,
  );
});

test("builds a concise attach-ready Telegram message", () => {
  const message = buildAttachReadyMessage({
    threadId: "thread-123",
    threadLabel: "Connect thread to Telegram",
    cwd: "D:\\Personal_Website",
    accessSummary: "full",
  });

  assert.match(message, /Telegram 已可用/);
  assert.match(message, /项目: Personal_Website/);
  assert.match(message, /当前线程: Connect thread to Telegram/);
  assert.match(message, /threadId: thread-123/);
  assert.match(message, /权限: full/);
});

test("adds a fallback notice to the attach-ready message when desktop access could not be read", () => {
  const message = buildAttachReadyMessage({
    threadId: "thread-123",
    threadLabel: "Connect thread to Telegram",
    cwd: "D:\\Personal_Website",
    accessSummary: "readonly",
    notice: "读取桌面端权限失败，采用默认权限 readonly",
  });

  assert.match(message, /权限: readonly/);
  assert.match(message, /读取桌面端权限失败，采用默认权限 readonly/);
});

test("builds a warning notice when the attached thread already has running turns", () => {
  const notice = buildBlockingTurnNotice({
    blockingTurn: {
      turnId: "turn-connect",
      textPreview: "Connect me to tg please",
    },
    lingeringTurns: [
      {
        turnId: "turn-stuck",
        textPreview: "Unable to activate workspace 还是这么显示",
      },
    ],
  });

  assert.match(notice ?? "", /最新 turn 仍未结束/);
  assert.match(notice ?? "", /Connect me \.\.\./);
  assert.match(notice ?? "", /有 1 个 lingering turns/);
  assert.match(notice ?? "", /\/interrupt/);
});

test("builds a warning notice for ignored lingering turns even when the latest turn is not running", () => {
  const notice = buildBlockingTurnNotice({
    blockingTurn: null,
    lingeringTurns: [
      {
        turnId: "turn-stuck",
        textPreview: "Unable to activate workspace 还是这么显示",
      },
      {
        turnId: "turn-older",
        textPreview: "好的开始",
      },
    ],
  });

  assert.doesNotMatch(notice ?? "", /已有未结束 turn/);
  assert.match(notice ?? "", /有 2 个 lingering turns/);
  assert.match(notice ?? "", /已忽略它们/);
});
