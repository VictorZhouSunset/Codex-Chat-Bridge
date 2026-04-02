import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";

import {
  fetchAndProcessTelegramUpdates,
  fetchTelegramUpdatesSafe,
  processTelegramUpdateBatch,
} from "../src/serve-loop.mjs";
import { attachBinding, createEmptyState, ensureStateFile } from "../src/binding-store.mjs";

test("fetchTelegramUpdatesSafe returns an empty list when polling fails", async () => {
  const observedErrors = [];

  const updates = await fetchTelegramUpdatesSafe({
    telegramApi: {
      async fetchUpdates() {
        throw new Error("poll failed");
      },
    },
    offset: 123,
    timeoutSeconds: 5,
    onError: (error) => {
      observedErrors.push(error.message);
    },
  });

  assert.deepEqual(updates, []);
  assert.deepEqual(observedErrors, ["poll failed"]);
});

test("processTelegramUpdateBatch stops at the first relay failure without advancing later offsets", async () => {
  const writes = [];
  const handled = [];
  const observedErrors = [];
  const observedCompletions = [];
  const state = { telegramOffset: 0 };

  await processTelegramUpdateBatch({
    updates: [
      {
        update_id: 10,
        message: {
          chat: { id: 1001 },
          text: "first message",
        },
      },
      {
        update_id: 11,
        message: {
          chat: { id: 1001 },
          text: "second message",
        },
      },
    ],
    state,
    statePath: "state.json",
    service: {
      async handleTelegramMessage(message) {
        handled.push(message.text);
        if (message.text === "first message") {
          throw new Error("relay exploded");
        }
        return {
          completion: Promise.resolve({ ok: true }),
        };
      },
    },
    config: {},
    writeStateFn: async (_statePath, nextState) => {
      writes.push({
        telegramOffset: nextState.telegramOffset,
        updateFailureCounts: structuredClone(nextState.updateFailureCounts ?? {}),
      });
    },
    observeRelayCompletionFn: (result) => {
      observedCompletions.push(result);
    },
    onError: (error) => {
      observedErrors.push(error.message);
    },
    isAllowedChat: () => true,
  });

  assert.deepEqual(handled, ["first message"]);
  assert.deepEqual(writes, [
    {
      telegramOffset: 0,
      updateFailureCounts: {
        "10": 1,
      },
    },
  ]);
  assert.deepEqual(observedErrors, ["relay exploded"]);
  assert.equal(observedCompletions.length, 0);
  assert.equal(state.telegramOffset, 0);
  assert.deepEqual(state.updateFailureCounts, {
    "10": 1,
  });
});

test("fetchAndProcessTelegramUpdates polls, writes offsets, and observes relay completions", async () => {
  const observedErrors = [];
  const writes = [];
  const handledMessages = [];
  const observedCompletions = [];

  await fetchAndProcessTelegramUpdates({
    statePath: "state.json",
    config: {
      pollIntervalMs: 5000,
    },
    telegramApi: {
      async fetchUpdates({ offset, timeoutSeconds }) {
        assert.equal(offset, 41);
        assert.equal(timeoutSeconds, 5);
        return [
          {
            update_id: 41,
            message: {
              chat: { id: 1001 },
              text: "hello from telegram",
            },
          },
        ];
      },
    },
    service: {
      async handleTelegramMessage(message) {
        handledMessages.push(message);
        return {
          completion: Promise.resolve({ ok: true }),
        };
      },
    },
    readStateFn: async () => ({
      telegramOffset: 41,
    }),
    writeStateFn: async (_statePath, state) => {
      writes.push(state.telegramOffset);
    },
    observeRelayCompletionFn: (result) => {
      observedCompletions.push(result);
    },
    onError: (error) => {
      observedErrors.push(error.message);
    },
    isAllowedChat: () => true,
  });

  assert.deepEqual(handledMessages, [
    {
      chatId: "1001",
      text: "hello from telegram",
    },
  ]);
  assert.deepEqual(writes, [42]);
  assert.equal(observedCompletions.length, 1);
  assert.deepEqual(observedErrors, []);
});

test("processTelegramUpdateBatch routes callback queries into bridge message handling", async () => {
  const writes = [];
  const handled = [];
  const answered = [];
  const state = { telegramOffset: 0 };

  await processTelegramUpdateBatch({
    updates: [
      {
        update_id: 12,
        callback_query: {
          id: "cbq-1",
          data: "permission:full",
          message: {
            chat: { id: 1001 },
          },
        },
      },
    ],
    state,
    statePath: "state.json",
    service: {
      async handleTelegramMessage(message) {
        handled.push(message);
        return {
          completion: Promise.resolve({ ok: true }),
        };
      },
    },
    telegramApi: {
      async answerCallbackQuery(callbackQueryId) {
        answered.push(callbackQueryId);
      },
    },
    config: {},
    writeStateFn: async (_statePath, nextState) => {
      writes.push(nextState.telegramOffset);
    },
    observeRelayCompletionFn: () => {},
    onError: (error) => {
      throw error;
    },
    isAllowedChat: () => true,
  });

  assert.deepEqual(handled, [
    {
      chatId: "1001",
      text: "permission:full",
      callbackQueryId: "cbq-1",
    },
  ]);
  assert.deepEqual(answered, ["cbq-1"]);
  assert.deepEqual(writes, [13]);
  assert.equal(state.telegramOffset, 13);
});

test("processTelegramUpdateBatch skips a poisoned update after three failures and notifies Telegram", async () => {
  const writes = [];
  const handled = [];
  const sentMessages = [];
  const observedErrors = [];
  const state = {
    telegramOffset: 10,
    updateFailureCounts: {
      "10": 2,
    },
  };

  await processTelegramUpdateBatch({
    updates: [
      {
        update_id: 10,
        message: {
          chat: { id: 1001 },
          text: "first message",
        },
      },
      {
        update_id: 11,
        message: {
          chat: { id: 1001 },
          text: "second message",
        },
      },
    ],
    state,
    statePath: "state.json",
    service: {
      async handleTelegramMessage(message) {
        handled.push(message.text);
        if (message.text === "first message") {
          throw new Error("relay exploded");
        }
        return {
          completion: Promise.resolve({ ok: true }),
        };
      },
    },
    telegramApi: {
      async sendMessage(chatId, text) {
        sentMessages.push({ chatId, text });
      },
    },
    config: {},
    writeStateFn: async (_statePath, nextState) => {
      writes.push({
        telegramOffset: nextState.telegramOffset,
        updateFailureCounts: structuredClone(nextState.updateFailureCounts ?? {}),
      });
    },
    observeRelayCompletionFn: () => {},
    onError: (error) => {
      observedErrors.push(error.message);
    },
    isAllowedChat: () => true,
  });

  assert.deepEqual(handled, ["first message", "second message"]);
  assert.deepEqual(sentMessages, [
    {
      chatId: "1001",
      text: "上一条命令出现错误，重试3次依然失败",
    },
  ]);
  assert.deepEqual(writes, [
    {
      telegramOffset: 11,
      updateFailureCounts: {},
    },
    {
      telegramOffset: 12,
      updateFailureCounts: {},
    },
  ]);
  assert.deepEqual(observedErrors, ["relay exploded"]);
  assert.equal(state.telegramOffset, 12);
  assert.deepEqual(state.updateFailureCounts, {});
});

test("processTelegramUpdateBatch still skips a poisoned update when the retry-limit notice fails", async () => {
  const writes = [];
  const observedErrors = [];
  const state = {
    telegramOffset: 20,
    updateFailureCounts: {
      "20": 2,
    },
  };

  await processTelegramUpdateBatch({
    updates: [
      {
        update_id: 20,
        message: {
          chat: { id: 1001 },
          text: "broken message",
        },
      },
    ],
    state,
    statePath: "state.json",
    service: {
      async handleTelegramMessage() {
        throw new Error("relay exploded again");
      },
    },
    telegramApi: {
      async sendMessage() {
        throw new Error("telegram unavailable");
      },
    },
    config: {},
    writeStateFn: async (_statePath, nextState) => {
      writes.push({
        telegramOffset: nextState.telegramOffset,
        updateFailureCounts: structuredClone(nextState.updateFailureCounts ?? {}),
      });
    },
    observeRelayCompletionFn: () => {},
    onError: (error) => {
      observedErrors.push(error.message);
    },
    isAllowedChat: () => true,
  });

  assert.deepEqual(writes, [
    {
      telegramOffset: 21,
      updateFailureCounts: {},
    },
  ]);
  assert.deepEqual(observedErrors, [
    "relay exploded again",
    "telegram unavailable",
  ]);
  assert.equal(state.telegramOffset, 21);
  assert.deepEqual(state.updateFailureCounts, {});
});

test("processTelegramUpdateBatch preserves active bindings already written to disk", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tg-bridge-loop-"));
  const statePath = path.join(tempDir, "state.json");
  await ensureStateFile(statePath);

  const staleState = createEmptyState();
  await attachBinding(statePath, {
    chatId: "1001",
    threadId: "thread-a",
    threadLabel: "Project A",
    cwd: "/tmp/project-a",
  });

  await processTelegramUpdateBatch({
    updates: [
      {
        update_id: 1,
        message: {
          chat: { id: 1001 },
          text: "hello after attach",
        },
      },
    ],
    state: staleState,
    statePath,
    service: {
      async handleTelegramMessage() {
        return {
          completion: Promise.resolve({ ok: true }),
        };
      },
    },
    telegramApi: {},
    config: {},
    observeRelayCompletionFn: () => {},
    onError: (error) => {
      throw error;
    },
    isAllowedChat: () => true,
  });

  const persisted = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(persisted.telegramOffset, 2);
  assert.deepEqual(persisted.activeBindings, {
    "1001": {
      chatId: "1001",
      threadId: "thread-a",
      threadLabel: "Project A",
      cwd: "/tmp/project-a",
      access: null,
      attachedAt: persisted.activeBindings["1001"].attachedAt,
    },
  });
});
