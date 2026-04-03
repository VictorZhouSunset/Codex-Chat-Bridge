// input: bridge runtime test cases that need fake Telegram APIs, fake Codex clients, and temp state files
// output: reusable deterministic fixtures for queueing, progress, shutdown, interrupt, and interactive bridge tests
// pos: shared test helper module for concern-based bridge-service suites
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

export function createFakeCodexClient() {
  return {
    relayCalls: [],
    attachedSessions: [],
    threadStatus: "idle",
    async attachThreadSession(payload) {
      this.attachedSessions.push(payload);
      return {
        threadId: payload.threadId,
        approvalPolicy: payload.approvalPolicy,
        sandboxPolicy: payload.sandboxPolicy,
        cwd: payload.cwd ?? null,
      };
    },
    async readThread(threadId) {
      return {
        id: threadId,
        status: this.threadStatus,
      };
    },
    async inspectActiveTurn(threadId) {
      if (this.threadStatus === "inProgress") {
        return {
          id: "turn-external",
          status: "inProgress",
          threadId,
        };
      }
      return null;
    },
    async relayText(payload) {
      this.relayCalls.push({
        threadId: payload.threadId,
        text: payload.text,
      });
      await payload.onProgress?.("正在读取 thread，以及其他 1 个动作\n（持续工作中）");
      await payload.onProgress?.("正在运行命令: pnpm test\n（持续工作中）");
      return {
        threadId: payload.threadId,
        turnId: "turn-1",
        text: `echo:${payload.text}`,
      };
    },
  };
}

export function createManualClock(startMs = 0) {
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

export async function waitForNextTask() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function createTestStatePath(t) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tg-bridge-service-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  return path.join(tempDir, "state.json");
}

export function createImmediateCodexClient() {
  return {
    relayCalls: [],
    attachedSessions: [],
    async attachThreadSession(payload) {
      this.attachedSessions.push(payload);
      return {
        threadId: payload.threadId,
        approvalPolicy: payload.approvalPolicy,
        sandboxPolicy: payload.sandboxPolicy,
        cwd: payload.cwd ?? null,
      };
    },
    async readThread(threadId) {
      return {
        id: threadId,
        status: "idle",
      };
    },
    async relayText(payload) {
      this.relayCalls.push({
        threadId: payload.threadId,
        text: payload.text,
      });
      return {
        threadId: payload.threadId,
        turnId: "turn-immediate",
        text: `echo:${payload.text}`,
      };
    },
  };
}

export function createQueuedCodexClient() {
  let releaseFirstRelay;
  let firstRelayStarted = false;
  let releaseRequested = false;

  return {
    relayCalls: [],
    attachedSessions: [],
    threadStatus: "idle",
    async attachThreadSession(payload) {
      this.attachedSessions.push(payload);
      return {
        threadId: payload.threadId,
        approvalPolicy: payload.approvalPolicy,
        sandboxPolicy: payload.sandboxPolicy,
        cwd: payload.cwd ?? null,
      };
    },
    async readThread(threadId) {
      return {
        id: threadId,
        status: this.threadStatus,
      };
    },
    async inspectActiveTurn(threadId) {
      if (this.threadStatus === "inProgress") {
        return {
          id: "turn-external",
          status: "inProgress",
          threadId,
        };
      }
      return null;
    },
    async relayText(payload) {
      this.relayCalls.push({
        threadId: payload.threadId,
        text: payload.text,
      });
      await payload.onProgress?.("正在运行命令: pnpm test\n（持续工作中）");
      if (!firstRelayStarted) {
        firstRelayStarted = true;
        await new Promise((resolve) => {
          releaseFirstRelay = resolve;
          if (releaseRequested) {
            releaseRequested = false;
            resolve();
          }
        });
      }

      return {
        threadId: payload.threadId,
        turnId: `turn-${this.relayCalls.length}`,
        text: `echo:${payload.text}`,
      };
    },
    releaseFirstRelay() {
      if (releaseFirstRelay) {
        releaseFirstRelay();
        return;
      }
      releaseRequested = true;
    },
  };
}

export function createInterruptibleQueuedCodexClient() {
  let pendingReject;
  let pendingResolve;
  let pendingThreadId = null;
  let interrupted = false;

  return {
    relayCalls: [],
    attachedSessions: [],
    interrupts: [],
    async attachThreadSession(payload) {
      this.attachedSessions.push(payload);
      return {
        threadId: payload.threadId,
        approvalPolicy: payload.approvalPolicy,
        sandboxPolicy: payload.sandboxPolicy,
        cwd: payload.cwd ?? null,
      };
    },
    async readThread(threadId) {
      return {
        id: threadId,
        status: pendingThreadId === threadId ? "inProgress" : "idle",
      };
    },
    async inspectActiveTurn(threadId) {
      if (pendingThreadId === threadId) {
        return {
          id: "turn-interruptible",
          status: "inProgress",
          threadId,
        };
      }
      return null;
    },
    async interruptTurn(payload) {
      this.interrupts.push(payload);
      interrupted = true;
      const error = new Error("Turn interrupted by Telegram user.");
      error.code = "TURN_INTERRUPTED";
      pendingThreadId = null;
      pendingReject?.(error);
      return { interrupted: true };
    },
    async relayText(payload) {
      this.relayCalls.push({
        threadId: payload.threadId,
        text: payload.text,
      });
      pendingThreadId = payload.threadId;
      await payload.onTurnStarted?.({
        threadId: payload.threadId,
        turnId: "turn-interruptible",
      });

      return new Promise((resolve, reject) => {
        pendingResolve = (result) => {
          pendingThreadId = null;
          resolve(result);
        };
        pendingReject = (error) => {
          pendingThreadId = null;
          reject(error);
        };

        if (interrupted) {
          const error = new Error("Turn interrupted by Telegram user.");
          error.code = "TURN_INTERRUPTED";
          pendingReject(error);
          return;
        }

        void payload.onProgress?.("正在读取 thread\n（持续工作中）");
      });
    },
    releaseRelay() {
      pendingResolve?.({
        threadId: pendingThreadId,
        turnId: "turn-interruptible",
        text: "echo:released",
      });
    },
  };
}

export function createFailingAttachCodexClient(message = "attach session failed") {
  return {
    attachedSessions: [],
    async attachThreadSession(payload) {
      this.attachedSessions.push(payload);
      throw new Error(message);
    },
  };
}

export function createSessionAwareCodexClient(options = {}) {
  let externalActiveTurn = options.externalActiveTurn ?? null;
  let attachedThreadId = options.attachedThreadId ?? null;
  let attached = attachedThreadId ? {
    threadId: attachedThreadId,
    approvalPolicy: options.approvalPolicy ?? "never",
    sandboxPolicy: options.sandboxPolicy ?? { type: "dangerFullAccess" },
    cwd: options.cwd ?? "D:\\project-a",
  } : null;

  return {
    attachedSessions: [],
    relayCalls: [],
    interrupts: [],
    async attachThreadSession(payload) {
      attached = {
        threadId: payload.threadId,
        approvalPolicy: payload.approvalPolicy,
        sandboxPolicy: payload.sandboxPolicy,
        cwd: payload.cwd ?? null,
      };
      attachedThreadId = payload.threadId;
      this.attachedSessions.push(payload);
      return attached;
    },
    async relayText(payload) {
      this.relayCalls.push(payload);
      if (!attached || attached.threadId !== payload.threadId) {
        const error = new Error("Attached thread session is not ready.");
        error.code = "THREAD_SESSION_NOT_READY";
        throw error;
      }
      return {
        threadId: payload.threadId,
        turnId: "turn-session-aware",
        text: `echo:${payload.text}`,
      };
    },
    async interruptTurn(payload) {
      this.interrupts.push(payload);
      if (!attached || attached.threadId !== payload.threadId) {
        const error = new Error("Attached thread session is not ready.");
        error.code = "THREAD_SESSION_NOT_READY";
        throw error;
      }
      if (externalActiveTurn && payload.threadId === externalActiveTurn.threadId) {
        externalActiveTurn = null;
      }
      return { interrupted: true };
    },
    async inspectActiveTurn(threadId) {
      if (externalActiveTurn && threadId === externalActiveTurn.threadId) {
        return {
          id: externalActiveTurn.turnId,
          status: "inProgress",
          threadId,
          textPreview: externalActiveTurn.textPreview ?? null,
        };
      }
      return null;
    },
    getAttachedThreadSession() {
      return attached;
    },
    clearAttachedThreadSession() {
      attached = null;
      attachedThreadId = null;
    },
    clearExternalActiveTurn() {
      externalActiveTurn = null;
    },
    setExternalActiveTurn(turn) {
      externalActiveTurn = turn;
    },
  };
}

export function createRejectingInterruptCodexClient(message = "interrupt failed") {
  let externalActiveTurn = {
    threadId: "thread-123",
    turnId: "turn-external",
    textPreview: "old turn",
  };
  let attached = null;

  return {
    attachedSessions: [],
    interrupts: [],
    async attachThreadSession(payload) {
      attached = {
        threadId: payload.threadId,
        approvalPolicy: payload.approvalPolicy,
        sandboxPolicy: payload.sandboxPolicy,
        cwd: payload.cwd ?? null,
      };
      this.attachedSessions.push(payload);
      externalActiveTurn.threadId = payload.threadId;
      return attached;
    },
    async inspectActiveTurn(threadId) {
      if (externalActiveTurn && externalActiveTurn.threadId === threadId) {
        return {
          id: externalActiveTurn.turnId,
          status: "inProgress",
          threadId,
          textPreview: externalActiveTurn.textPreview,
        };
      }
      return null;
    },
    async interruptTurn(payload) {
      this.interrupts.push(payload);
      await Promise.resolve();
      throw new Error(message);
    },
    getAttachedThreadSession() {
      return attached;
    },
    clearAttachedThreadSession() {
      attached = null;
    },
  };
}

export function createDeferredInterruptCodexClient() {
  let externalActiveTurn = {
    threadId: "thread-123",
    turnId: "turn-external",
    textPreview: "old turn",
  };
  let attached = null;
  let interruptResolve;
  let interruptReject;
  const interruptPromise = new Promise((resolve, reject) => {
    interruptResolve = resolve;
    interruptReject = reject;
  });

  return {
    attachedSessions: [],
    relayCalls: [],
    interrupts: [],
    async attachThreadSession(payload) {
      attached = {
        threadId: payload.threadId,
        approvalPolicy: payload.approvalPolicy,
        sandboxPolicy: payload.sandboxPolicy,
        cwd: payload.cwd ?? null,
      };
      this.attachedSessions.push(payload);
      externalActiveTurn.threadId = payload.threadId;
      return attached;
    },
    async inspectActiveTurn(threadId) {
      if (externalActiveTurn && externalActiveTurn.threadId === threadId) {
        return {
          id: externalActiveTurn.turnId,
          status: "inProgress",
          threadId,
          textPreview: externalActiveTurn.textPreview,
        };
      }
      return null;
    },
    async interruptTurn(payload) {
      this.interrupts.push(payload);
      await interruptPromise;
      externalActiveTurn = null;
      return { interrupted: true };
    },
    async relayText(payload) {
      this.relayCalls.push({
        threadId: payload.threadId,
        text: payload.text,
      });
      await payload.onTurnStarted?.({
        threadId: payload.threadId,
        turnId: "turn-new",
      });
      return {
        threadId: payload.threadId,
        turnId: "turn-new",
        text: `echo:${payload.text}`,
      };
    },
    resolveInterrupt() {
      interruptResolve?.();
    },
    rejectInterrupt(error) {
      interruptReject?.(error);
    },
    getAttachedThreadSession() {
      return attached;
    },
    clearAttachedThreadSession() {
      attached = null;
    },
    clearExternalActiveTurn() {
      externalActiveTurn = null;
    },
    setExternalActiveTurn(turn) {
      externalActiveTurn = turn;
    },
  };
}

export function createHangingRelayCodexClient() {
  let attached = null;
  let relayReject;
  return {
    attachedSessions: [],
    relayCalls: [],
    async attachThreadSession(payload) {
      attached = {
        threadId: payload.threadId,
        approvalPolicy: payload.approvalPolicy,
        sandboxPolicy: payload.sandboxPolicy,
        cwd: payload.cwd ?? null,
      };
      this.attachedSessions.push(payload);
      return attached;
    },
    async inspectActiveTurn() {
      return null;
    },
    async relayText(payload) {
      this.relayCalls.push({
        threadId: payload.threadId,
        text: payload.text,
      });
      await payload.onTurnStarted?.({
        threadId: payload.threadId,
        turnId: "turn-hanging",
      });
      return new Promise((resolve, reject) => {
        relayReject = reject;
      });
    },
    async close() {
      const error = new Error("Codex app-server client closed.");
      error.code = "CLIENT_CLOSED";
      relayReject?.(error);
    },
    getAttachedThreadSession() {
      return attached;
    },
    clearAttachedThreadSession() {
      attached = null;
    },
  };
}

export function createInspectFailingAttachCodexClient(message = "inspect failed") {
  let attached = null;
  return {
    attachedSessions: [],
    async attachThreadSession(payload) {
      attached = {
        threadId: payload.threadId,
        approvalPolicy: payload.approvalPolicy,
        sandboxPolicy: payload.sandboxPolicy,
        cwd: payload.cwd ?? null,
      };
      this.attachedSessions.push(payload);
      return attached;
    },
    async inspectActiveTurn() {
      throw new Error(message);
    },
    getAttachedThreadSession() {
      return attached;
    },
    clearAttachedThreadSession() {
      attached = null;
    },
  };
}

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

export function createReadThreadFailsDuringWorkerCodexClient() {
  return {
    attachedSessions: [],
    relayCalls: [],
    async attachThreadSession(payload) {
      this.attachedSessions.push(payload);
      return {
        threadId: payload.threadId,
        approvalPolicy: payload.approvalPolicy,
        sandboxPolicy: payload.sandboxPolicy,
        cwd: payload.cwd ?? null,
      };
    },
    async relayText(payload) {
      this.relayCalls.push({
        threadId: payload.threadId,
        text: payload.text,
      });
      throw new Error("thread lookup failed");
    },
  };
}

export function createThrottledCodexClient() {
  let releaseRelay;
  let releaseRequested = false;
  const relayReady = new Promise((resolve) => {
    releaseRelay = resolve;
    if (releaseRequested) {
      releaseRequested = false;
      resolve();
    }
  });

  return {
    relayCalls: [],
    releaseRelay() {
      if (releaseRelay) {
        releaseRelay();
        return;
      }
      releaseRequested = true;
    },
    async readThread(threadId) {
      return {
        id: threadId,
        status: "idle",
      };
    },
    async relayText(payload) {
      this.relayCalls.push({
        threadId: payload.threadId,
        text: payload.text,
      });
      await payload.onProgress?.("正在读取 thread\n（持续工作中）");
      await payload.onProgress?.("正在运行命令: pnpm test\n（持续工作中）");
      await payload.onProgress?.("正在调用工具: playwright.browser_click\n（持续工作中）");
      await relayReady;
      return {
        threadId: payload.threadId,
        turnId: "turn-throttle",
        text: `echo:${payload.text}`,
      };
    },
  };
}

export function createDelayedProgressCodexClient() {
  let releaseSecondProgress;
  let releaseRelay;

  const secondProgressReady = new Promise((resolve) => {
    releaseSecondProgress = resolve;
  });
  const relayReady = new Promise((resolve) => {
    releaseRelay = resolve;
  });

  return {
    relayCalls: [],
    releaseSecondProgress() {
      releaseSecondProgress?.();
    },
    releaseRelay() {
      releaseRelay?.();
    },
    async readThread(threadId) {
      return {
        id: threadId,
        status: "idle",
      };
    },
    async relayText(payload) {
      this.relayCalls.push({
        threadId: payload.threadId,
        text: payload.text,
      });
      await payload.onProgress?.("正在读取 thread\n（持续工作中）");
      await secondProgressReady;
      await payload.onProgress?.("正在运行命令: pnpm test\n（持续工作中）");
      await relayReady;
      return {
        threadId: payload.threadId,
        turnId: "turn-delayed-progress",
        text: `echo:${payload.text}`,
      };
    },
  };
}

export function createInteractivePromptCodexClient() {
  let approvalResponseResolve;
  const approvalResponse = new Promise((resolve) => {
    approvalResponseResolve = resolve;
  });

  let userInputResponseResolve;
  const userInputResponse = new Promise((resolve) => {
    userInputResponseResolve = resolve;
  });

  return {
    relayCalls: [],
    async readThread(threadId) {
      return {
        id: threadId,
        status: "idle",
      };
    },
    async interruptTurn() {
      return { interrupted: true };
    },
    async relayText(payload) {
      this.relayCalls.push({
        threadId: payload.threadId,
        text: payload.text,
      });

      const approval = await payload.onInteractiveRequest?.({
        kind: "command_approval",
        requestId: "approval-1",
        threadId: payload.threadId,
        turnId: "turn-interactive",
        itemId: "item-approval",
        command: "pnpm test",
        cwd: "D:\\project-a",
        reason: "Need approval to run tests.",
      });
      approvalResponseResolve?.(approval);

      const userInput = await payload.onInteractiveRequest?.({
        kind: "user_input",
        requestId: "input-1",
        threadId: payload.threadId,
        turnId: "turn-interactive",
        itemId: "item-input",
        questions: [
          {
            id: "tone",
            header: "Tone",
            question: "Pick a tone",
            isOther: true,
            isSecret: false,
            options: [
              { label: "Short", description: "Keep it concise" },
              { label: "Friendly", description: "Make it warm" },
            ],
          },
          {
            id: "note",
            header: "Note",
            question: "Add a short note",
            isOther: true,
            isSecret: false,
            options: null,
          },
        ],
      });
      userInputResponseResolve?.(userInput);

      return {
        threadId: payload.threadId,
        turnId: "turn-interactive",
        text: `approval:${approval?.decision ?? "none"} input:${userInput?.answers?.tone?.answers?.[0] ?? "none"} / ${userInput?.answers?.note?.answers?.[0] ?? "none"}`,
      };
    },
    waitForApprovalResponse() {
      return approvalResponse;
    },
    waitForUserInputResponse() {
      return userInputResponse;
    },
  };
}

export function createApprovalOnlyPromptCodexClient() {
  let approvalResponseResolve;
  const approvalResponse = new Promise((resolve) => {
    approvalResponseResolve = resolve;
  });

  return {
    relayCalls: [],
    async readThread(threadId) {
      return {
        id: threadId,
        status: "idle",
      };
    },
    async interruptTurn() {
      return { interrupted: true };
    },
    async relayText(payload) {
      this.relayCalls.push({
        threadId: payload.threadId,
        text: payload.text,
      });

      const approval = await payload.onInteractiveRequest?.({
        kind: "command_approval",
        requestId: "approval-1",
        threadId: payload.threadId,
        turnId: "turn-interactive",
        itemId: "item-approval",
        command: "pnpm test",
        cwd: "D:\\project-a",
        reason: "Need approval to run tests.",
      });
      approvalResponseResolve?.(approval);

      return {
        threadId: payload.threadId,
        turnId: "turn-interactive",
        text: `approval:${approval?.decision ?? "none"}`,
      };
    },
    waitForApprovalResponse() {
      return approvalResponse;
    },
  };
}

export function createDoubleApprovalPromptCodexClient() {
  let firstApprovalResponseResolve;
  const firstApprovalResponse = new Promise((resolve) => {
    firstApprovalResponseResolve = resolve;
  });

  let secondApprovalResponseResolve;
  const secondApprovalResponse = new Promise((resolve) => {
    secondApprovalResponseResolve = resolve;
  });

  return {
    relayCalls: [],
    async readThread(threadId) {
      return {
        id: threadId,
        status: "idle",
      };
    },
    async interruptTurn() {
      return { interrupted: true };
    },
    async relayText(payload) {
      this.relayCalls.push({
        threadId: payload.threadId,
        text: payload.text,
      });

      const firstApprovalPromise = payload.onInteractiveRequest?.({
        kind: "command_approval",
        requestId: "approval-1",
        threadId: payload.threadId,
        turnId: "turn-double-approval",
        itemId: "item-approval-1",
        command: "pnpm test",
        cwd: "D:\\project-a",
        reason: "Need approval to run tests.",
      });

      const secondApprovalPromise = payload.onInteractiveRequest?.({
        kind: "command_approval",
        requestId: "approval-2",
        threadId: payload.threadId,
        turnId: "turn-double-approval",
        itemId: "item-approval-2",
        command: "cargo test",
        cwd: "D:\\project-a",
        reason: "Need approval to run cargo tests.",
      });

      const firstApproval = await firstApprovalPromise;
      firstApprovalResponseResolve?.(firstApproval);

      const secondApproval = await secondApprovalPromise;
      secondApprovalResponseResolve?.(secondApproval);

      return {
        threadId: payload.threadId,
        turnId: "turn-double-approval",
        text: `approvals:${firstApproval?.decision ?? "none"}/${secondApproval?.decision ?? "none"}`,
      };
    },
    waitForFirstApprovalResponse() {
      return firstApprovalResponse;
    },
    waitForSecondApprovalResponse() {
      return secondApprovalResponse;
    },
  };
}
