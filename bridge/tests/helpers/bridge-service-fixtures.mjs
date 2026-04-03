// input: bridge runtime test suites that need shared fake Codex clients plus aggregated Telegram/state fixture exports
// output: codex-heavy bridge-service fixtures and stable re-exports for concern-focused helper modules
// pos: barrel-style bridge-service test helper surface that keeps existing suite imports stable
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
export {
  createManualClock,
  createTestStatePath,
  waitForNextTask,
} from "./bridge-service/state-fixtures.mjs";
export {
  createBlockingFirstSendTelegramApi,
  createBlockingNthSendTelegramApi,
  createFakeTelegramApi,
  createFailingShutdownTelegramApi,
} from "./bridge-service/telegram-fixtures.mjs";

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
    async inspectActiveTurns(threadId) {
      const activeTurn = await this.inspectActiveTurn(threadId);
      return activeTurn ? [activeTurn] : [];
    },
    async interruptTurn() {
      this.threadStatus = "idle";
      return { interrupted: true };
    },
    async interruptAllTurns({ threadId, turns = null }) {
      const activeTurns = Array.isArray(turns) ? turns : await this.inspectActiveTurns(threadId);
      this.threadStatus = "idle";
      return {
        threadId,
        totalTurns: activeTurns.length,
        interruptedTurnIds: activeTurns.map((turn) => turn.id),
        failures: [],
      };
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
    async inspectActiveTurns(threadId) {
      const activeTurn = await this.inspectActiveTurn(threadId);
      return activeTurn ? [activeTurn] : [];
    },
    async interruptTurn() {
      this.threadStatus = "idle";
      return { interrupted: true };
    },
    async interruptAllTurns({ threadId, turns = null }) {
      const activeTurns = Array.isArray(turns) ? turns : await this.inspectActiveTurns(threadId);
      this.threadStatus = "idle";
      return {
        threadId,
        totalTurns: activeTurns.length,
        interruptedTurnIds: activeTurns.map((turn) => turn.id),
        failures: [],
      };
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
    async inspectActiveTurns(threadId) {
      const activeTurn = await this.inspectActiveTurn(threadId);
      return activeTurn ? [activeTurn] : [];
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
    async interruptAllTurns({ threadId, turns = null }) {
      const activeTurns = Array.isArray(turns) ? turns : await this.inspectActiveTurns(threadId);
      const results = await Promise.allSettled(
        activeTurns.map((turn) => this.interruptTurn({ threadId, turnId: turn.id })),
      );
      return {
        threadId,
        totalTurns: activeTurns.length,
        interruptedTurnIds: results
          .map((result, index) => (result.status === "fulfilled" ? activeTurns[index].id : null))
          .filter(Boolean),
        failures: results
          .map((result, index) =>
            result.status === "rejected"
              ? { turnId: activeTurns[index].id, error: result.reason }
              : null,
          )
          .filter(Boolean),
      };
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
  let threadTurns = normalizeThreadTurns(options.threadTurns ?? []);
  let externalActiveTurns = normalizeExternalTurns(
    options.externalActiveTurns ?? options.externalActiveTurn ?? null,
  );
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
    async readThread(threadId, options = {}) {
      if (!options.includeTurns) {
        return {
          id: threadId,
          status: "idle",
          turns: [],
        };
      }
      return {
        id: threadId,
        status: "idle",
        turns: threadTurns
          .filter((turn) => turn.threadId === threadId)
          .map((turn) => ({
            id: turn.turnId,
            status: turn.status,
            items: turn.textPreview
              ? [
                  {
                    type: "userMessage",
                    content: [{ type: "text", text: turn.textPreview, text_elements: [] }],
                  },
                ]
              : [],
          })),
      };
    },
    async inspectThreadActivity(threadId) {
      const turns = [
        ...threadTurns.filter((turn) => turn.threadId === threadId),
        ...externalActiveTurns
          .filter((turn) => turn.threadId === threadId)
          .map((turn) => ({
            threadId: turn.threadId,
            turnId: turn.turnId,
            status: "inProgress",
            textPreview: turn.textPreview ?? null,
          })),
      ];
      const latestTurn = turns.at(-1) ?? null;
      const inProgressTurns = turns.filter((turn) => turn.status === "inProgress");
      const blockingTurn =
        latestTurn?.status === "inProgress"
          ? {
              id: latestTurn.turnId,
              status: latestTurn.status,
              threadId,
              textPreview: latestTurn.textPreview ?? null,
            }
          : null;
      const lingeringTurns = inProgressTurns
        .filter((turn) => turn.turnId !== blockingTurn?.id)
        .map((turn) => ({
          id: turn.turnId,
          status: turn.status,
          threadId,
          textPreview: turn.textPreview ?? null,
        }));
      return {
        latestTurn: latestTurn
          ? {
              id: latestTurn.turnId,
              status: latestTurn.status,
              threadId,
              textPreview: latestTurn.textPreview ?? null,
            }
          : null,
        blockingTurn,
        lingeringTurns,
        inProgressTurns: [
          ...(blockingTurn ? [blockingTurn] : []),
          ...lingeringTurns,
        ],
      };
    },
    async interruptTurn(payload) {
      this.interrupts.push(payload);
      if (!attached || attached.threadId !== payload.threadId) {
        const error = new Error("Attached thread session is not ready.");
        error.code = "THREAD_SESSION_NOT_READY";
        throw error;
      }
      externalActiveTurns = externalActiveTurns.filter((turn) => turn.turnId !== payload.turnId);
      return { interrupted: true };
    },
    async interruptAllTurns({ threadId, turns = null }) {
      const activeTurns = Array.isArray(turns) ? turns : await this.inspectActiveTurns(threadId);
      const interruptedTurnIds = activeTurns.map((turn) => turn.id ?? turn.turnId).filter(Boolean);
      this.interrupts.push(
        ...interruptedTurnIds.map((turnId) => ({
          threadId,
          turnId,
        })),
      );
      externalActiveTurns = externalActiveTurns.filter((turn) => turn.threadId !== threadId);
      return {
        threadId,
        totalTurns: activeTurns.length,
        interruptedTurnIds,
        failures: [],
      };
    },
    async inspectActiveTurn(threadId) {
      const turns = await this.inspectActiveTurns(threadId);
      return turns.at(-1) ?? null;
    },
    async inspectActiveTurns(threadId) {
      return externalActiveTurns
        .filter((turn) => threadId === turn.threadId)
        .map((turn) => ({
          id: turn.turnId,
          status: "inProgress",
          threadId,
          textPreview: turn.textPreview ?? null,
        }));
    },
    getAttachedThreadSession() {
      return attached;
    },
    clearAttachedThreadSession() {
      attached = null;
      attachedThreadId = null;
    },
    clearExternalActiveTurn() {
      externalActiveTurns = [];
    },
    setExternalActiveTurn(turn) {
      externalActiveTurns = normalizeExternalTurns(turn);
    },
    setExternalActiveTurns(turns) {
      externalActiveTurns = normalizeExternalTurns(turns);
    },
  };
}

export function createRejectingInterruptCodexClient(message = "interrupt failed") {
  let externalActiveTurns = normalizeExternalTurns({
    threadId: "thread-123",
    turnId: "turn-external",
    textPreview: "old turn",
  });
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
      externalActiveTurns = externalActiveTurns.map((turn) => ({
        ...turn,
        threadId: payload.threadId,
      }));
      return attached;
    },
    async inspectActiveTurn(threadId) {
      const turns = await this.inspectActiveTurns(threadId);
      return turns.at(-1) ?? null;
    },
    async inspectActiveTurns(threadId) {
      return externalActiveTurns
        .filter((turn) => turn.threadId === threadId)
        .map((turn) => ({
          id: turn.turnId,
          status: "inProgress",
          threadId,
          textPreview: turn.textPreview,
        }));
    },
    async interruptTurn(payload) {
      this.interrupts.push(payload);
      await Promise.resolve();
      throw new Error(message);
    },
    async interruptAllTurns({ threadId, turns = null }) {
      const activeTurns = Array.isArray(turns) ? turns : await this.inspectActiveTurns(threadId);
      this.interrupts.push(
        ...activeTurns.map((turn) => ({
          threadId,
          turnId: turn.id,
        })),
      );
      const failures = activeTurns.map((turn) => ({
        turnId: turn.id,
        error: new Error(message),
      }));
      throw failures[0].error;
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
  let externalActiveTurns = normalizeExternalTurns({
    threadId: "thread-123",
    turnId: "turn-external",
    textPreview: "old turn",
  });
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
      externalActiveTurns = externalActiveTurns.map((turn) => ({
        ...turn,
        threadId: payload.threadId,
      }));
      return attached;
    },
    async inspectActiveTurn(threadId) {
      const turns = await this.inspectActiveTurns(threadId);
      return turns.at(-1) ?? null;
    },
    async inspectActiveTurns(threadId) {
      return externalActiveTurns
        .filter((turn) => turn.threadId === threadId)
        .map((turn) => ({
          id: turn.turnId,
          status: "inProgress",
          threadId,
          textPreview: turn.textPreview,
        }));
    },
    async interruptTurn(payload) {
      this.interrupts.push(payload);
      await interruptPromise;
      externalActiveTurns = externalActiveTurns.filter((turn) => turn.turnId !== payload.turnId);
      return { interrupted: true };
    },
    async interruptAllTurns({ threadId, turns = null }) {
      const activeTurns = Array.isArray(turns) ? turns : await this.inspectActiveTurns(threadId);
      const results = await Promise.allSettled(
        activeTurns.map((turn) => this.interruptTurn({ threadId, turnId: turn.id })),
      );
      return {
        threadId,
        totalTurns: activeTurns.length,
        interruptedTurnIds: results
          .map((result, index) => (result.status === "fulfilled" ? activeTurns[index].id : null))
          .filter(Boolean),
        failures: results
          .map((result, index) =>
            result.status === "rejected"
              ? { turnId: activeTurns[index].id, error: result.reason }
              : null,
          )
          .filter(Boolean),
      };
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
      externalActiveTurns = [];
    },
    setExternalActiveTurn(turn) {
      externalActiveTurns = normalizeExternalTurns(turn);
    },
    setExternalActiveTurns(turns) {
      externalActiveTurns = normalizeExternalTurns(turns);
    },
  };
}

export function createFailureReportingInterruptCodexClient(message = "Interrupt request timed out while waiting for Codex app-server.") {
  let externalActiveTurns = normalizeExternalTurns([
    {
      threadId: "thread-123",
      turnId: "turn-old",
      textPreview: "Unable to activate workspace 还是这么显示",
    },
    {
      threadId: "thread-123",
      turnId: "turn-new",
      textPreview: "Connect me to tg please",
    },
  ]);
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
      externalActiveTurns = externalActiveTurns.map((turn) => ({
        ...turn,
        threadId: payload.threadId,
      }));
      return attached;
    },
    async inspectActiveTurn(threadId) {
      const turns = await this.inspectActiveTurns(threadId);
      return turns.at(-1) ?? null;
    },
    async inspectActiveTurns(threadId) {
      return externalActiveTurns
        .filter((turn) => turn.threadId === threadId)
        .map((turn) => ({
          id: turn.turnId,
          status: "inProgress",
          threadId,
          textPreview: turn.textPreview,
        }));
    },
    async interruptAllTurns({ threadId, turns = null }) {
      const activeTurns = Array.isArray(turns) ? turns : await this.inspectActiveTurns(threadId);
      const failures = activeTurns.map((turn) => {
        const turnId = turn.id ?? turn.turnId;
        this.interrupts.push({ threadId, turnId });
        return {
          turnId,
          error: new Error(message),
        };
      });
      return {
        threadId,
        totalTurns: activeTurns.length,
        interruptedTurnIds: [],
        failures,
      };
    },
    getAttachedThreadSession() {
      return attached;
    },
    clearAttachedThreadSession() {
      attached = null;
    },
  };
}

export function createNonClearingInterruptCodexClient() {
  let externalActiveTurns = normalizeExternalTurns([
    {
      threadId: "thread-123",
      turnId: "turn-old",
      textPreview: "Unable to activate workspace 还是这么显示",
    },
    {
      threadId: "thread-123",
      turnId: "turn-new",
      textPreview: "Connect me to tg please",
    },
  ]);
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
      externalActiveTurns = externalActiveTurns.map((turn) => ({
        ...turn,
        threadId: payload.threadId,
      }));
      return attached;
    },
    async inspectActiveTurn(threadId) {
      const turns = await this.inspectActiveTurns(threadId);
      return turns.at(-1) ?? null;
    },
    async inspectActiveTurns(threadId) {
      return externalActiveTurns
        .filter((turn) => turn.threadId === threadId)
        .map((turn) => ({
          id: turn.turnId,
          status: "inProgress",
          threadId,
          textPreview: turn.textPreview,
        }));
    },
    async interruptAllTurns({ threadId, turns = null }) {
      const activeTurns = Array.isArray(turns) ? turns : await this.inspectActiveTurns(threadId);
      const interruptedTurnIds = activeTurns.map((turn) => turn.id ?? turn.turnId).filter(Boolean);
      this.interrupts.push(
        ...interruptedTurnIds.map((turnId) => ({
          threadId,
          turnId,
        })),
      );
      return {
        threadId,
        totalTurns: activeTurns.length,
        interruptedTurnIds,
        failures: [],
      };
    },
    getAttachedThreadSession() {
      return attached;
    },
    clearAttachedThreadSession() {
      attached = null;
    },
  };
}

function normalizeExternalTurns(turns) {
  if (!turns) {
    return [];
  }
  const values = Array.isArray(turns) ? turns : [turns];
  return values.filter(Boolean).map((turn) => ({
    threadId: turn.threadId,
    turnId: turn.turnId ?? turn.id,
    textPreview: turn.textPreview ?? null,
  }));
}

function normalizeThreadTurns(turns) {
  if (!turns) {
    return [];
  }
  const values = Array.isArray(turns) ? turns : [turns];
  return values.filter(Boolean).map((turn) => ({
    threadId: turn.threadId,
    turnId: turn.turnId ?? turn.id,
    status: turn.status ?? "completed",
    textPreview: turn.textPreview ?? null,
  }));
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
