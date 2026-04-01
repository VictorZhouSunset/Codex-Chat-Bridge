// input: relay job state, progress text, Telegram API client, timing configuration
// output: throttled Telegram typing actions and progress-message send/edit side effects
// pos: runtime helper that owns Telegram-facing progress UX for one relay job
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
export function createRelayJob(text, { resolve = () => {}, reject = () => {} } = {}) {
  return {
    text,
    progressMessageId: null,
    lastProgressText: null,
    pendingProgressText: null,
    progressFlushTimerId: null,
    lastProgressEditAt: 0,
    workStartedAt: 0,
    resolve,
    reject,
  };
}

export class TelegramProgressTracker {
  constructor(options) {
    this.telegramApi = options.telegramApi;
    this.typingIntervalMs = options.typingIntervalMs ?? 4000;
    this.initialProgressDelayMs = options.initialProgressDelayMs ?? 1200;
    this.progressEditIntervalMs = options.progressEditIntervalMs ?? 1000;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  startTyping(chatId) {
    if (!this.telegramApi?.sendChatAction) {
      return createNoopTypingController();
    }

    let stopped = false;
    let paused = false;
    let intervalId = null;
    const sendTyping = async () => {
      if (stopped || paused) {
        return;
      }
      try {
        await this.telegramApi.sendChatAction(chatId, "typing");
      } catch {}
    };

    void sendTyping();
    intervalId = setInterval(() => {
      void sendTyping();
    }, this.typingIntervalMs);

    return {
      pause() {
        paused = true;
      },
      resume() {
        if (stopped) {
          return;
        }
        paused = false;
        void sendTyping();
      },
      stop() {
        stopped = true;
        if (intervalId) {
          clearInterval(intervalId);
        }
      },
    };
  }

  async sendBestEffortMessage(chatId, messageText) {
    try {
      await this.telegramApi?.sendMessage?.(chatId, messageText);
    } catch {}
  }

  async updateProgressMessage(chatId, job, progressText) {
    if (!progressText || job.lastProgressText === progressText) {
      return;
    }

    if (!job.progressMessageId && !job.lastProgressText) {
      const elapsedMs = Math.max(0, Date.now() - (job.workStartedAt || Date.now()));
      if (elapsedMs < this.initialProgressDelayMs) {
        job.pendingProgressText = progressText;
        this.#scheduleProgressFlush(chatId, job, this.initialProgressDelayMs - elapsedMs);
        return;
      }
    }

    const now = Date.now();
    const canEditImmediately =
      !job.lastProgressEditAt || now - job.lastProgressEditAt >= this.progressEditIntervalMs;

    if (canEditImmediately) {
      await this.#editProgressMessage(chatId, job, progressText);
      return;
    }

    job.pendingProgressText = progressText;
    this.#scheduleProgressFlush(chatId, job, this.progressEditIntervalMs - (now - job.lastProgressEditAt));
  }

  async flushPendingProgress(chatId, job, options) {
    const allowInitialSend = options?.allowInitialSend ?? true;
    if (job.progressFlushTimerId) {
      this.clearTimeoutFn(job.progressFlushTimerId);
      job.progressFlushTimerId = null;
    }

    const nextProgressText = job.pendingProgressText;
    if (!nextProgressText || nextProgressText === job.lastProgressText) {
      job.pendingProgressText = null;
      return;
    }

    if (
      !allowInitialSend &&
      !job.progressMessageId &&
      !this.#hasReachedInitialProgressDelay(job)
    ) {
      job.pendingProgressText = null;
      return;
    }

    await this.#editProgressMessage(chatId, job, nextProgressText);
  }

  async #editProgressMessage(chatId, job, progressText) {
    if (job.progressFlushTimerId) {
      this.clearTimeoutFn(job.progressFlushTimerId);
      job.progressFlushTimerId = null;
    }
    job.pendingProgressText = null;

    if (job.progressMessageId && this.telegramApi?.editMessageText) {
      await this.telegramApi.editMessageText(chatId, job.progressMessageId, progressText);
      job.lastProgressText = progressText;
      job.lastProgressEditAt = Date.now();
      return;
    }

    const progressMessage = await this.telegramApi?.sendMessage?.(chatId, progressText);
    job.progressMessageId = getTelegramMessageId(progressMessage) ?? job.progressMessageId ?? null;
    job.lastProgressText = progressText;
    job.lastProgressEditAt = Date.now();
  }

  #scheduleProgressFlush(chatId, job, delayMs) {
    if (job.progressFlushTimerId) {
      return;
    }

    job.progressFlushTimerId = this.setTimeoutFn(() => {
      job.progressFlushTimerId = null;
      void this.flushPendingProgress(chatId, job, { allowInitialSend: true });
    }, Math.max(0, delayMs));
  }

  #hasReachedInitialProgressDelay(job) {
    const elapsedMs = Math.max(0, Date.now() - (job.workStartedAt || Date.now()));
    return elapsedMs >= this.initialProgressDelayMs;
  }
}

function createNoopTypingController() {
  return {
    pause() {},
    resume() {},
    stop() {},
  };
}

function getTelegramMessageId(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  if (typeof message.messageId === "number") {
    return message.messageId;
  }

  if (typeof message.message_id === "number") {
    return message.message_id;
  }

  return null;
}
