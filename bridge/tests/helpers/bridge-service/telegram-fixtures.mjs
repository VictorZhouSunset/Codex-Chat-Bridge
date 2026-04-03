// input: bridge runtime test cases that need fake Telegram send, edit, callback, and blocking behaviors
// output: reusable Telegram API doubles for bridge-service lifecycle, queueing, and progress tests
// pos: shared Telegram transport fixture module for bridge-service test support
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
export function createFakeTelegramApi() {
  let nextMessageId = 1;
  return {
    sent: [],
    actions: [],
    edited: [],
    answeredCallbacks: [],
    async sendMessage(chatId, text, options = {}) {
      const message = { chatId, text, ...options, message_id: nextMessageId++ };
      this.sent.push(message);
      return message;
    },
    async sendChatAction(chatId, action) {
      this.actions.push({ chatId, action });
    },
    async editMessageText(chatId, messageId, text) {
      this.edited.push({ chatId, messageId, text });
      return { chatId, messageId, text };
    },
    async answerCallbackQuery(callbackQueryId, options = {}) {
      this.answeredCallbacks.push({ callbackQueryId, ...options });
    },
  };
}

export function createBlockingFirstSendTelegramApi() {
  let nextMessageId = 1;
  let resolveFirstSend;
  let firstSendStartedResolve;
  const firstSendStarted = new Promise((resolve) => {
    firstSendStartedResolve = resolve;
  });
  let firstSendBlocked = true;

  return {
    sent: [],
    actions: [],
    edited: [],
    firstSendStarted,
    releaseFirstSend() {
      if (!firstSendBlocked) {
        return;
      }
      firstSendBlocked = false;
      resolveFirstSend?.();
    },
    async sendMessage(chatId, text) {
      const message = { chatId, text, message_id: nextMessageId++ };
      this.sent.push(message);

      if (firstSendBlocked) {
        firstSendStartedResolve?.();
        await new Promise((resolve) => {
          resolveFirstSend = resolve;
        });
      }

      return message;
    },
    async sendChatAction(chatId, action) {
      this.actions.push({ chatId, action });
    },
    async editMessageText(chatId, messageId, text) {
      this.edited.push({ chatId, messageId, text });
      return { chatId, messageId, text };
    },
  };
}

export function createBlockingNthSendTelegramApi(blockedSendNumber) {
  let nextMessageId = 1;
  let sendCount = 0;
  let resolveBlockedSend;
  let blockedSendStartedResolve;
  const blockedSendStarted = new Promise((resolve) => {
    blockedSendStartedResolve = resolve;
  });
  let blocked = true;

  return {
    sent: [],
    actions: [],
    edited: [],
    blockedSendStarted,
    releaseBlockedSend() {
      if (!blocked) {
        return;
      }
      blocked = false;
      resolveBlockedSend?.();
    },
    async sendMessage(chatId, text) {
      sendCount += 1;
      const message = { chatId, text, message_id: nextMessageId++ };
      this.sent.push(message);

      if (blocked && sendCount === blockedSendNumber) {
        blockedSendStartedResolve?.();
        await new Promise((resolve) => {
          resolveBlockedSend = resolve;
        });
      }

      return message;
    },
    async sendChatAction(chatId, action) {
      this.actions.push({ chatId, action });
    },
    async editMessageText(chatId, messageId, text) {
      this.edited.push({ chatId, messageId, text });
      return { chatId, messageId, text };
    },
  };
}

export function createFailingShutdownTelegramApi() {
  const base = createFakeTelegramApi();
  return {
    ...base,
    async sendMessage(chatId, text) {
      if (/shutdown/i.test(text)) {
        throw new Error("telegram send failed");
      }
      return base.sendMessage.call(this, chatId, text);
    },
  };
}
