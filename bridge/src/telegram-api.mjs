const TELEGRAM_API_ROOT = "https://api.telegram.org";
const TELEGRAM_MESSAGE_LIMIT = 3500;

export class TelegramApi {
  constructor({ token }) {
    if (!token) {
      throw new Error("Telegram bot token is required.");
    }
    this.token = token;
  }

  async fetchUpdates({ offset = 0, timeoutSeconds = 20 } = {}) {
    const response = await this.#request("getUpdates", {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ["message", "callback_query"],
    });
    return response.result ?? [];
  }

  async sendMessage(chatId, text, options = {}) {
    let lastResult = null;
    const chunks = splitTelegramText(text);
    for (const [index, chunk] of chunks.entries()) {
      const response = await this.#request("sendMessage", {
        chat_id: chatId,
        text: chunk,
        ...(index === 0 && options.reply_markup ? { reply_markup: options.reply_markup } : {}),
      });
      lastResult = response.result ?? null;
    }
    return lastResult;
  }

  async sendChatAction(chatId, action) {
    await this.#request("sendChatAction", {
      chat_id: chatId,
      action,
    });
  }

  async editMessageText(chatId, messageId, text) {
    const [chunk] = splitTelegramText(text);
    const response = await this.#request("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: chunk,
    });
    return response.result ?? null;
  }

  async setMyCommands(commands) {
    await this.#request("setMyCommands", {
      commands,
    });
  }

  async answerCallbackQuery(callbackQueryId, options = {}) {
    await this.#request("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(options.text ? { text: options.text } : {}),
    });
  }

  async #request(method, body) {
    const response = await fetch(`${TELEGRAM_API_ROOT}/bot${this.token}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Telegram API ${method} failed with HTTP ${response.status}.`);
    }

    const data = await response.json();
    if (!data.ok) {
      throw new Error(`Telegram API ${method} failed: ${data.description ?? "Unknown error"}`);
    }
    return data;
  }
}

export function splitTelegramText(text) {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [text];
  }

  const chunks = [];
  let remaining = text;
  while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
    chunks.push(remaining.slice(0, TELEGRAM_MESSAGE_LIMIT));
    remaining = remaining.slice(TELEGRAM_MESSAGE_LIMIT);
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}
