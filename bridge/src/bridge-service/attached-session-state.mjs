// input: binding metadata, attached-thread session snapshots, interrupt probes, and observed turn updates
// output: normalized attached-session state transitions plus formatted active-turn snapshots for the bridge runtime
// pos: internal state helper for bridge-service attached-session tracking
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import { createTurnIdsKey } from "./runtime-helpers.mjs";

export class AttachedSessionState {
  constructor(options = {}) {
    this.clearAttachedThreadSession = options.clearAttachedThreadSession ?? (() => {});
    this.nowFn = options.nowFn ?? Date.now;
    this.current = null;
    this.turnEpochCounter = 0;
  }

  startSession({ binding, effectiveAccess, sessionStartedAt, generation }) {
    this.current = createAttachedSession({
      binding,
      effectiveAccess,
      sessionStartedAt,
      generation,
    });
    return this.current;
  }

  replace(session) {
    this.current = session ?? null;
  }

  getSnapshot() {
    return this.current ? structuredClone(this.current) : null;
  }

  hasReadySessionForBinding(binding, clientSession) {
    const clientSessionMatches =
      clientSession &&
      binding &&
      clientSession.threadId === binding.threadId &&
      clientSession.sessionReady !== false;

    return Boolean(
      binding &&
        this.current &&
        this.current.sessionReady &&
        this.current.chatId === binding.chatId &&
        this.current.threadId === binding.threadId &&
        clientSessionMatches,
    );
  }

  syncMetadata(binding) {
    if (!this.current || !binding) {
      return;
    }
    this.current = {
      ...this.current,
      threadLabel: binding.threadLabel ?? null,
      cwd: binding.cwd ?? null,
      access: binding.access ?? null,
    };
  }

  matchesInterruptSession(interruptSession) {
    const currentTurns = this.current?.activeTurns ?? [];
    const turnsMatch =
      currentTurns.length === 0 ||
      createTurnIdsKey(currentTurns) === interruptSession.turnIdsKey;
    return Boolean(
      interruptSession &&
        this.current &&
        this.current.generation === interruptSession.generation &&
        this.current.chatId === interruptSession.chatId &&
        this.current.threadId === interruptSession.threadId &&
        this.current.turnEpoch === interruptSession.turnEpoch &&
        turnsMatch,
    );
  }

  setActiveTurn(activeTurn) {
    if (!this.current) {
      return;
    }
    const turnEpoch = this.#resolveTurnEpoch(activeTurn);
    this.current = {
      ...this.current,
      turnEpoch,
      degradedReason: null,
      lingeringTurns: [],
      activeTurn: {
        chatId: activeTurn.chatId,
        threadId: activeTurn.threadId,
        turnId: activeTurn.turnId ?? null,
        startedAt: activeTurn.startedAt,
        textPreview: activeTurn.textPreview ?? null,
        source: "bridge",
        turnEpoch,
      },
      activeTurns: [
        {
          chatId: activeTurn.chatId,
          threadId: activeTurn.threadId,
          turnId: activeTurn.turnId ?? null,
          startedAt: activeTurn.startedAt,
          textPreview: activeTurn.textPreview ?? null,
          source: "bridge",
          inProgress: true,
          turnEpoch,
        },
      ],
    };
  }

  clearActiveTurn() {
    if (!this.current) {
      return;
    }
    this.current = {
      ...this.current,
      activeTurn: null,
      activeTurns: [],
    };
  }

  setObservedTurns({ blockingTurn = null, lingeringTurns = [] }) {
    if (!this.current?.sessionReady) {
      return;
    }
    const latestTurn = blockingTurn ?? null;
    const normalizedLingeringTurns = Array.isArray(lingeringTurns) ? lingeringTurns : [];
    if (!latestTurn && normalizedLingeringTurns.length === 0) {
      this.clearObservedTurns();
      return;
    }
    const turnEpoch = latestTurn
      ? this.#resolveTurnEpoch(latestTurn)
      : this.current.turnEpoch ?? ++this.turnEpochCounter;
    this.current = {
      ...this.current,
      turnEpoch,
      activeTurn: latestTurn
        ? {
            chatId: latestTurn.chatId,
            threadId: latestTurn.threadId,
            turnId: latestTurn.turnId ?? null,
            startedAt: latestTurn.startedAt ?? null,
            textPreview: latestTurn.textPreview ?? null,
            source: latestTurn.source ?? "attached-thread",
            inProgress: latestTurn.inProgress ?? true,
            turnEpoch,
          }
        : null,
      activeTurns: [
        ...normalizedLingeringTurns.map((turn) => ({
          chatId: turn.chatId,
          threadId: turn.threadId,
          turnId: turn.turnId ?? null,
          startedAt: turn.startedAt ?? null,
          textPreview: turn.textPreview ?? null,
          source: turn.source ?? "attached-thread",
          inProgress: turn.inProgress ?? true,
          turnEpoch,
        })),
        ...(latestTurn
          ? [
              {
                chatId: latestTurn.chatId,
                threadId: latestTurn.threadId,
                turnId: latestTurn.turnId ?? null,
                startedAt: latestTurn.startedAt ?? null,
                textPreview: latestTurn.textPreview ?? null,
                source: latestTurn.source ?? "attached-thread",
                inProgress: latestTurn.inProgress ?? true,
                turnEpoch,
              },
            ]
          : []),
      ],
      lingeringTurns: normalizedLingeringTurns.map((turn) => ({
        chatId: turn.chatId,
        threadId: turn.threadId,
        turnId: turn.turnId ?? null,
        startedAt: turn.startedAt ?? null,
        textPreview: turn.textPreview ?? null,
        source: turn.source ?? "attached-thread",
        inProgress: turn.inProgress ?? true,
        turnEpoch,
      })),
    };
  }

  clearObservedTurns() {
    if (!this.current) {
      return;
    }
    const hasObservedAttachedTurn = this.current.activeTurn?.source === "attached-thread";
    const hasObservedLingeringTurns = (this.current.lingeringTurns ?? []).some(
      (turn) => (turn?.source ?? "attached-thread") === "attached-thread",
    );
    if (!hasObservedAttachedTurn && !hasObservedLingeringTurns) {
      return;
    }
    this.current = {
      ...this.current,
      activeTurn: null,
      activeTurns: [],
      lingeringTurns: [],
    };
  }

  markDegraded(reason) {
    if (!this.current) {
      return;
    }
    this.current = {
      ...this.current,
      sessionReady: false,
      degradedReason: reason ?? "unknown",
      activeTurn: null,
      activeTurns: [],
      lingeringTurns: [],
    };
    this.clearAttachedThreadSession();
  }

  clear() {
    this.current = null;
    this.clearAttachedThreadSession();
  }

  formatTurn(activeTurn) {
    if (!activeTurn) {
      return null;
    }
    return {
      chatId: activeTurn.chatId,
      threadId: activeTurn.threadId,
      turnId: activeTurn.turnId ?? null,
      startedAt: activeTurn.startedAt ?? null,
      textPreview: activeTurn.textPreview ?? null,
      source: activeTurn.source ?? "bridge",
      inProgress: activeTurn.inProgress ?? false,
      turnEpoch: activeTurn.turnEpoch ?? null,
      runningForMs:
        typeof activeTurn.startedAt === "number" ? this.nowFn() - activeTurn.startedAt : undefined,
    };
  }

  formatTurns(activeTurns) {
    const turns = Array.isArray(activeTurns) ? activeTurns : [];
    return turns.map((turn) => this.formatTurn(turn)).filter(Boolean);
  }

  #resolveTurnEpoch(activeTurn) {
    const currentTurn = this.current?.activeTurn ?? null;
    if (this.#isSameTurnContext(currentTurn, activeTurn)) {
      return currentTurn?.turnEpoch ?? this.current?.turnEpoch ?? ++this.turnEpochCounter;
    }
    return ++this.turnEpochCounter;
  }

  #isSameTurnContext(currentTurn, nextTurn) {
    if (!currentTurn || !nextTurn) {
      return false;
    }
    if (
      currentTurn.chatId !== nextTurn.chatId ||
      currentTurn.threadId !== nextTurn.threadId ||
      (currentTurn.source ?? "bridge") !== (nextTurn.source ?? "bridge")
    ) {
      return false;
    }
    if (currentTurn.turnId && nextTurn.turnId) {
      return currentTurn.turnId === nextTurn.turnId;
    }
    return currentTurn.source === "bridge" && (currentTurn.turnId == null || nextTurn.turnId == null);
  }
}

export function createAttachedSession({ binding, effectiveAccess, sessionStartedAt, generation }) {
  return {
    chatId: binding.chatId,
    threadId: binding.threadId,
    threadLabel: binding.threadLabel ?? null,
    cwd: binding.cwd ?? null,
    access: binding.access ?? null,
    effectiveAccess,
    sessionStartedAt,
    generation,
    sessionReady: true,
    turnEpoch: 0,
    degradedReason: null,
    activeTurn: null,
    activeTurns: [],
    lingeringTurns: [],
  };
}
