// input: fake Telegram API, fake Codex client, interactive prompt payloads
// output: verified prompt queue behavior and Telegram prompt text side effects
// pos: unit test for the extracted interactive prompt runtime helper
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { InteractivePromptManager } from "../src/interactive-prompt-manager.mjs";

function createFakeTelegramApi() {
  let nextMessageId = 1;
  return {
    sent: [],
    async sendMessage(chatId, text) {
      const message = { chatId, text, message_id: nextMessageId++ };
      this.sent.push(message);
      return message;
    },
  };
}

function createFakeCodexClient() {
  return {
    interrupts: [],
    async interruptTurn(payload) {
      this.interrupts.push(payload);
      return { interrupted: true };
    },
  };
}

function createTypingController() {
  return {
    pauseCount: 0,
    resumeCount: 0,
    stopCount: 0,
    pause() {
      this.pauseCount += 1;
    },
    resume() {
      this.resumeCount += 1;
    },
    stop() {
      this.stopCount += 1;
    },
  };
}

test("queues interactive approvals and advances to the next prompt after approval", async () => {
  const telegramApi = createFakeTelegramApi();
  const manager = new InteractivePromptManager({
    telegramApi,
    codexClient: createFakeCodexClient(),
  });

  const firstTyping = createTypingController();
  const secondTyping = createTypingController();
  const firstResponse = manager.enqueue({
    chatId: "1001",
    request: {
      kind: "command_approval",
      requestId: "approval-1",
      threadId: "thread-1",
      turnId: "turn-1",
      command: "pnpm test",
      cwd: "D:\\project-a",
      reason: "Need approval to run tests.",
    },
    typing: firstTyping,
  });
  const secondResponse = manager.enqueue({
    chatId: "1001",
    request: {
      kind: "command_approval",
      requestId: "approval-2",
      threadId: "thread-1",
      turnId: "turn-1",
      command: "cargo test",
      cwd: "D:\\project-a",
      reason: "Need approval to run cargo tests.",
    },
    typing: secondTyping,
  });

  assert.equal(manager.getPendingCount(), 2);
  assert.match(telegramApi.sent[0].text, /pnpm test/i);

  const firstReply = await manager.handleReply("1001", "approve");
  assert.deepEqual(firstReply, { accepted: true });
  assert.deepEqual(await firstResponse, { decision: "accept" });
  assert.match(telegramApi.sent[1].text, /cargo test/i);

  const secondReply = await manager.handleReply("1001", "deny");
  assert.deepEqual(secondReply, { accepted: true });
  assert.deepEqual(await secondResponse, { decision: "decline" });
  assert.equal(secondTyping.resumeCount, 1);
});

test("supports multi-question user input prompts and slash cancel", async () => {
  const telegramApi = createFakeTelegramApi();
  const codexClient = createFakeCodexClient();
  const manager = new InteractivePromptManager({
    telegramApi,
    codexClient,
  });

  const typing = createTypingController();
  const responsePromise = manager.enqueue({
    chatId: "1001",
    request: {
      kind: "user_input",
      requestId: "input-1",
      threadId: "thread-1",
      turnId: "turn-1",
      questions: [
        {
          id: "tone",
          question: "Pick a tone",
          options: [
            { label: "Short" },
            { label: "Friendly" },
          ],
        },
        {
          id: "note",
          question: "Add a note",
          options: null,
        },
      ],
    },
    typing,
  });

  assert.match(telegramApi.sent[0].text, /Pick a tone/i);

  const firstReply = await manager.handleReply("1001", "2");
  assert.deepEqual(firstReply, { accepted: true });
  assert.match(telegramApi.sent[1].text, /Add a note/i);

  const secondReply = await manager.handleReply("1001", "Ship it");
  assert.deepEqual(secondReply, { accepted: true });
  assert.deepEqual(await responsePromise, {
    answers: {
      tone: { answers: ["Friendly"] },
      note: { answers: ["Ship it"] },
    },
  });

  const cancelledPromise = manager.enqueue({
    chatId: "1001",
    request: {
      kind: "command_approval",
      requestId: "approval-cancel",
      threadId: "thread-1",
      turnId: "turn-2",
      command: "pnpm lint",
    },
    typing: createTypingController(),
  });

  await assert.rejects(async () => {
    await manager.handleReply("1001", "/cancel");
    await cancelledPromise;
  }, /Turn interrupted by Telegram user/i);
  assert.deepEqual(codexClient.interrupts, [
    {
      threadId: "thread-1",
      turnId: "turn-2",
    },
  ]);
});
