// input: Telegram prompt requests, Telegram reply text, Codex interrupt capability
// output: queued interactive prompt responses and Telegram-facing prompt messages
// pos: runtime helper that owns interactive approvals and request_user_input flow
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
export class InteractivePromptManager {
  constructor({ telegramApi, codexClient }) {
    this.telegramApi = telegramApi;
    this.codexClient = codexClient;
    this.pendingByChat = new Map();
  }

  enqueue({ chatId, request, typing }) {
    typing?.pause?.();

    return new Promise((resolve, reject) => {
      const prompt = {
        kind: request.kind,
        requestId: request.requestId,
        threadId: request.threadId,
        turnId: request.turnId,
        chatId,
        request,
        typing,
        answers: {},
        questionIndex: 0,
        resolve,
        reject,
      };

      const queue = this.pendingByChat.get(chatId) ?? [];
      const shouldPromptNow = queue.length === 0;
      queue.push(prompt);
      this.#setQueue(chatId, queue);
      if (shouldPromptNow) {
        void this.#sendPrompt(chatId, prompt);
      }
    });
  }

  getActive(chatId) {
    const queue = this.pendingByChat.get(chatId) ?? [];
    return queue[0] ?? null;
  }

  getPendingCount() {
    let count = 0;
    for (const queue of this.pendingByChat.values()) {
      count += queue.length;
    }
    return count;
  }

  clearRequest(chatId, requestId) {
    const removedPrompt = this.#removePrompt(chatId, requestId);
    if (!removedPrompt) {
      return;
    }

    if (!this.getActive(chatId)) {
      removedPrompt.typing?.resume?.();
    }
  }

  async handleReply(chatId, text) {
    const prompt = this.getActive(chatId);
    if (!prompt) {
      return { ignored: true };
    }

    const trimmed = `${text ?? ""}`.trim();
    if (!trimmed) {
      return { ignored: true };
    }

    if (isCancelReply(trimmed)) {
      await this.codexClient?.interruptTurn?.({
        threadId: prompt.threadId,
        turnId: prompt.turnId,
      });

      const error = createInterruptedError();
      const cancelledPrompts = this.#takeQueue(chatId);
      for (const queuedPrompt of cancelledPrompts) {
        queuedPrompt.reject(error);
      }
      prompt.typing?.stop?.();
      await this.telegramApi.sendMessage(chatId, "已取消当前等待中的请求，Codex 将停止这一轮。");
      return { interrupted: true };
    }

    if (prompt.kind === "command_approval") {
      const response = parseApprovalReply(trimmed, {
        acceptedDecision: "accept",
        deniedDecision: "decline",
      });
      if (!response) {
        await this.telegramApi.sendMessage(chatId, "请回复 `approve` 或 `deny`。");
        return { invalid: true };
      }

      const nextPrompt = await this.#advanceQueue(chatId, prompt.requestId);
      prompt.resolve(response);
      if (!nextPrompt) {
        prompt.typing?.resume?.();
        await this.telegramApi.sendMessage(chatId, "已收到审批结果，继续处理中。");
      }
      return { accepted: true };
    }

    if (prompt.kind === "file_change_approval") {
      const response = parseApprovalReply(trimmed, {
        acceptedDecision: "approved",
        deniedDecision: "denied",
      });
      if (!response) {
        await this.telegramApi.sendMessage(chatId, "请回复 `approve` 或 `deny`。");
        return { invalid: true };
      }

      const nextPrompt = await this.#advanceQueue(chatId, prompt.requestId);
      prompt.resolve(response);
      if (!nextPrompt) {
        prompt.typing?.resume?.();
        await this.telegramApi.sendMessage(chatId, "已收到文件变更审批结果，继续处理中。");
      }
      return { accepted: true };
    }

    if (prompt.kind === "user_input") {
      const question = prompt.request.questions[prompt.questionIndex];
      const answer = parseUserInputAnswer(question, trimmed);
      if (!answer) {
        await this.telegramApi.sendMessage(chatId, "这个回答我没读懂，请按编号回复，或者直接输入文字答案。");
        return { invalid: true };
      }

      prompt.answers[question.id] = {
        answers: [answer],
      };
      prompt.questionIndex += 1;

      if (prompt.questionIndex >= prompt.request.questions.length) {
        const nextPrompt = await this.#advanceQueue(chatId, prompt.requestId);
        prompt.resolve({
          answers: prompt.answers,
        });
        if (!nextPrompt) {
          prompt.typing?.resume?.();
          await this.telegramApi.sendMessage(chatId, "已收到回答，继续处理中。");
        }
        return { accepted: true };
      }

      await this.telegramApi.sendMessage(
        chatId,
        formatUserInputQuestionPrompt(
          prompt.request.questions[prompt.questionIndex],
          prompt.questionIndex,
          prompt.request.questions.length,
        ),
      );
      return { accepted: true };
    }

    return { ignored: true };
  }

  async interruptAll(chatId) {
    const prompts = this.#takeQueue(chatId);
    if (prompts.length === 0) {
      return;
    }

    const leadPrompt = prompts[0];
    await this.codexClient?.interruptTurn?.({
      threadId: leadPrompt.threadId,
      turnId: leadPrompt.turnId,
    });

    for (const prompt of prompts) {
      prompt.typing?.stop?.();
      prompt.reject(createInterruptedError());
    }
  }

  async #advanceQueue(chatId, requestId) {
    const removedPrompt = this.#removePrompt(chatId, requestId);
    if (!removedPrompt) {
      return null;
    }

    const nextPrompt = this.getActive(chatId);
    if (nextPrompt) {
      await this.#sendPrompt(chatId, nextPrompt);
    }
    return nextPrompt;
  }

  async #sendPrompt(chatId, prompt) {
    if (prompt.kind === "command_approval") {
      await this.telegramApi.sendMessage(chatId, formatCommandApprovalPrompt(prompt.request));
      return;
    }

    if (prompt.kind === "file_change_approval") {
      await this.telegramApi.sendMessage(chatId, formatFileChangeApprovalPrompt(prompt.request));
      return;
    }

    if (prompt.kind === "user_input") {
      await this.telegramApi.sendMessage(
        chatId,
        formatUserInputQuestionPrompt(
          prompt.request.questions[prompt.questionIndex],
          prompt.questionIndex,
          prompt.request.questions.length,
        ),
      );
    }
  }

  #setQueue(chatId, queue) {
    if (!queue || queue.length === 0) {
      this.pendingByChat.delete(chatId);
      return;
    }

    this.pendingByChat.set(chatId, queue);
  }

  #takeQueue(chatId) {
    const queue = this.pendingByChat.get(chatId) ?? [];
    this.pendingByChat.delete(chatId);
    return queue;
  }

  #removePrompt(chatId, requestId) {
    const queue = [...(this.pendingByChat.get(chatId) ?? [])];
    if (queue.length === 0) {
      return null;
    }

    const index = queue.findIndex((prompt) => String(prompt.requestId) === String(requestId));
    if (index === -1) {
      return null;
    }

    const [removedPrompt] = queue.splice(index, 1);
    this.#setQueue(chatId, queue);
    return removedPrompt;
  }
}

function isCancelReply(text) {
  return /^\/?cancel$/i.test(text.trim());
}

function createInterruptedError() {
  const error = new Error("Turn interrupted by Telegram user.");
  error.code = "TURN_INTERRUPTED";
  return error;
}

function parseApprovalReply(text, { acceptedDecision, deniedDecision }) {
  const normalized = text.trim().toLowerCase();
  if (["approve", "approved", "yes", "y", "ok", "允许", "批准", "同意"].includes(normalized)) {
    return { decision: acceptedDecision };
  }
  if (["deny", "denied", "no", "n", "拒绝", "不同意"].includes(normalized)) {
    return { decision: deniedDecision };
  }
  return null;
}

function formatCommandApprovalPrompt(request) {
  const command = request.command ?? "unknown command";
  const cwdLine = request.cwd ? `\n目录: ${request.cwd}` : "";
  const reasonLine = request.reason ? `\n原因: ${request.reason}` : "";
  return `Codex 需要执行命令审批：\n命令: ${command}${cwdLine}${reasonLine}\n请回复 approve 或 deny。`;
}

function formatFileChangeApprovalPrompt(request) {
  const reasonLine = request.reason ? `\n原因: ${request.reason}` : "";
  const rootLine = request.grantRoot ? `\n写入范围: ${request.grantRoot}` : "";
  return `Codex 需要文件变更审批。${reasonLine}${rootLine}\n请回复 approve 或 deny。`;
}

function formatUserInputQuestionPrompt(question, index, total) {
  if (!question) {
    return "Codex 需要额外输入。";
  }

  const options = Array.isArray(question.options) && question.options.length > 0
    ? `\n${question.options.map((option, optionIndex) => `${optionIndex + 1}. ${option.label}`).join("\n")}`
    : "";
  return `Codex 需要你回答问题 ${index + 1}/${total}：\n${question.question}${options}\n可直接回复编号或文字。`;
}

function parseUserInputAnswer(question, text) {
  const trimmed = text.trim();
  if (!question) {
    return trimmed || null;
  }

  if (Array.isArray(question.options) && question.options.length > 0) {
    const index = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(index) && index >= 1 && index <= question.options.length) {
      return question.options[index - 1].label;
    }

    const matchedOption = question.options.find((option) => option.label.toLowerCase() === trimmed.toLowerCase());
    if (matchedOption) {
      return matchedOption.label;
    }
  }

  return trimmed || null;
}
