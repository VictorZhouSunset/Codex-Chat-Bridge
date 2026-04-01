// input: fake Telegram API, manual clock, relay job state, progress text updates
// output: verified typing and progress-message throttling behavior for relay jobs
// pos: unit test for the extracted Telegram progress runtime helper
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { TelegramProgressTracker, createRelayJob } from "../src/telegram-progress.mjs";

function createFakeTelegramApi() {
  let nextMessageId = 1;
  return {
    sent: [],
    edited: [],
    actions: [],
    async sendMessage(chatId, text) {
      const message = { chatId, text, message_id: nextMessageId++ };
      this.sent.push(message);
      return message;
    },
    async editMessageText(chatId, messageId, text) {
      this.edited.push({ chatId, messageId, text });
      return { chatId, messageId, text };
    },
    async sendChatAction(chatId, action) {
      this.actions.push({ chatId, action });
    },
  };
}

function createManualClock(startMs = 0) {
  let nowMs = startMs;
  let nextTimerId = 1;
  const timers = new Map();

  return {
    now() {
      return nowMs;
    },
    setTimeoutFn(callback, delayMs) {
      const timerId = nextTimerId++;
      timers.set(timerId, {
        callback,
        runAt: nowMs + Math.max(0, delayMs),
      });
      return timerId;
    },
    clearTimeoutFn(timerId) {
      timers.delete(timerId);
    },
    async advance(ms) {
      nowMs += ms;
      while (true) {
        const dueTimers = [...timers.entries()]
          .filter(([, timer]) => timer.runAt <= nowMs)
          .sort((left, right) => left[1].runAt - right[1].runAt);

        if (dueTimers.length === 0) {
          break;
        }

        for (const [timerId, timer] of dueTimers) {
          timers.delete(timerId);
          timer.callback();
        }

        await Promise.resolve();
      }
    },
  };
}

test("buffers the first progress update until the initial delay expires, then edits the same message", async (t) => {
  const clock = createManualClock();
  const realDateNow = Date.now;
  Date.now = () => clock.now();
  t.after(() => {
    Date.now = realDateNow;
  });

  const telegramApi = createFakeTelegramApi();
  const tracker = new TelegramProgressTracker({
    telegramApi,
    initialProgressDelayMs: 1_000,
    progressEditIntervalMs: 1_000,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });
  const job = createRelayJob("continue");
  job.workStartedAt = Date.now();

  await tracker.updateProgressMessage("1001", job, "正在读取 thread\n（持续工作中）");
  assert.deepEqual(telegramApi.sent, []);

  await clock.advance(1_000);
  assert.deepEqual(telegramApi.sent, [
    {
      chatId: "1001",
      text: "正在读取 thread\n（持续工作中）",
      message_id: 1,
    },
  ]);

  await tracker.updateProgressMessage("1001", job, "正在运行命令: pnpm test\n（持续工作中）");
  await clock.advance(1_000);
  assert.deepEqual(telegramApi.edited, [
    {
      chatId: "1001",
      messageId: 1,
      text: "正在运行命令: pnpm test\n（持续工作中）",
    },
  ]);
});

test("starts and stops Telegram typing without leaking timers", () => {
  const telegramApi = createFakeTelegramApi();
  const tracker = new TelegramProgressTracker({
    telegramApi,
    typingIntervalMs: 5_000,
  });

  const typing = tracker.startTyping("1001");
  typing.pause();
  typing.resume();
  typing.stop();

  assert.deepEqual(telegramApi.actions, [
    {
      chatId: "1001",
      action: "typing",
    },
    {
      chatId: "1001",
      action: "typing",
    },
  ]);
});
