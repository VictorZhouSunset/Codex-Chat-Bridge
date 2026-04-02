// input: Telegram messages, persisted bindings, Codex app-server client, Telegram API client
// output: relay queue progression, Telegram side effects, runtime status, interrupt controls, and shutdown transitions
// pos: top-level runtime orchestrator for the Node bridge daemon
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import {
  clearAllBindings,
  detachBinding,
  ensureStateFile,
  getBinding,
  getLastRelayRecord,
  readState,
  replaceAllBindingsWith,
  updateLastRelayRecord,
  updateBinding,
} from "./binding-store.mjs";
import {
  applyPermissionLevel,
  describeAccessSummary,
  resolveEffectiveAccess,
} from "./access-profile.mjs";
import {
  buildChangesMessage,
  buildHelpMessage,
  buildLastErrorMessage,
  buildStatusMessage,
  readWorkspaceChanges as defaultReadWorkspaceChanges,
} from "./bridge-diagnostics.mjs";
import { classifyTelegramText } from "./commands.mjs";
import { InteractivePromptManager } from "./interactive-prompt-manager.mjs";
import { TelegramProgressTracker, createRelayJob } from "./telegram-progress.mjs";

export class BridgeService {
  constructor(options) {
    this.statePath = options.statePath;
    this.codexClient = options.codexClient;
    this.telegramApi = options.telegramApi;
    this.pendingByChat = new Map();
    this.processingChats = new Set();
    this.activeRelays = new Map();
    this.attachedSession = null;
    this.nowFn = options.nowFn ?? Date.now;
    this.threadPollIntervalMs = options.threadPollIntervalMs ?? 1000;
    this.waitFn = options.waitFn ?? wait;
    this.mode = "idle";
    this.shutdownRequested = false;
    this.shutdownSource = null;
    this.shouldExit = false;
    this.readWorkspaceChanges = options.readWorkspaceChanges ?? defaultReadWorkspaceChanges;
    this.progressTracker = new TelegramProgressTracker({
      telegramApi: this.telegramApi,
      typingIntervalMs: options.typingIntervalMs,
      initialProgressDelayMs: options.initialProgressDelayMs,
      progressEditIntervalMs: options.progressEditIntervalMs,
      setTimeoutFn: options.setTimeoutFn,
      clearTimeoutFn: options.clearTimeoutFn,
    });
    this.interactivePrompts = new InteractivePromptManager({
      telegramApi: this.telegramApi,
      codexClient: this.codexClient,
    });
  }

  async attach(binding) {
    await ensureStateFile(this.statePath);
    const state = await readState(this.statePath);
    const existingBinding = Object.values(state.activeBindings ?? {})[0] ?? null;
    if (
      existingBinding &&
      (existingBinding.chatId !== binding.chatId || existingBinding.threadId !== binding.threadId)
    ) {
      const error = new Error(
        `Telegram chat ${existingBinding.chatId} is already attached to thread ${existingBinding.threadId}${existingBinding.threadLabel ? ` (${existingBinding.threadLabel})` : ""}. Detach it before attaching a new thread.`,
      );
      error.code = "BINDING_CONFLICT";
      error.binding = existingBinding;
      throw error;
    }

    if (this.#hasReadySessionForBinding(binding)) {
      const persistedBinding = await replaceAllBindingsWith(this.statePath, binding);
      this.#syncAttachedSessionMetadata(persistedBinding);
      return persistedBinding;
    }

    const effectiveAccess = resolveEffectiveAccess(binding.access);
    if (this.codexClient?.attachThreadSession) {
      await this.codexClient.attachThreadSession({
        threadId: binding.threadId,
        approvalPolicy: effectiveAccess.approvalPolicy,
        sandboxPolicy: effectiveAccess.sandboxPolicy,
        cwd: binding.cwd ?? undefined,
      });
    }

    try {
      const persistedBinding = await replaceAllBindingsWith(this.statePath, binding);
      this.attachedSession = createAttachedSession({
        binding: persistedBinding,
        effectiveAccess,
        sessionStartedAt: this.nowFn(),
      });
      this.mode = "idle";
      this.shouldExit = false;
      this.shutdownRequested = false;
      this.shutdownSource = null;
      return persistedBinding;
    } catch (error) {
      this.#clearAttachedSession();
      throw error;
    }
  }

  async detach(chatId) {
    await ensureStateFile(this.statePath);
    await detachBinding(this.statePath, chatId);
    if (this.attachedSession?.chatId === chatId) {
      this.#clearAttachedSession();
    }
    await this.#syncShutdownIntentFromBindings();
  }

  async getStatus(chatId) {
    await ensureStateFile(this.statePath);
    return {
      binding: await getBinding(this.statePath, chatId),
    };
  }

  async getRuntimeStatus() {
    await ensureStateFile(this.statePath);
    const state = await readState(this.statePath);
    return {
      mode: this.#deriveMode(state),
      activeJobCount: this.processingChats.size,
      shutdownRequested: this.shutdownRequested,
      shutdownSource: this.shutdownSource,
      shouldExit: this.shouldExit,
      queueDepth: this.#getQueueDepth(),
      pendingInteractiveCount: this.interactivePrompts.getPendingCount(),
      attachedSession: this.attachedSession ? structuredClone(this.attachedSession) : null,
      activeRelays: [...this.activeRelays.values()].map((relay) => ({
        ...relay,
        runningForMs: this.nowFn() - relay.startedAt,
      })),
    };
  }

  async requestShutdown(source = "unknown") {
    await ensureStateFile(this.statePath);
    this.shutdownRequested = true;
    this.shutdownSource = source;

    if (this.processingChats.size === 0) {
      await this.#transitionToReadyToStop();
      return this.getRuntimeStatus();
    }

    this.mode = "draining";
    this.shouldExit = true;
    await this.#dropQueuedJobs(buildDrainingMessage(this.shutdownSource));
    return this.getRuntimeStatus();
  }

  async handleTelegramMessage(message) {
    await ensureStateFile(this.statePath);
    const classification = classifyTelegramText(message.text);
    const pendingInteractive = this.interactivePrompts.getActive(message.chatId);

    if (classification.kind === "cancel") {
      if (pendingInteractive) {
        return this.#handleInteractiveReply(message.chatId, message.text);
      }
      await this.telegramApi.sendMessage(message.chatId, "当前没有可取消的等待请求。");
      return { kind: "cancel" };
    }

    if (classification.kind === "help") {
      await this.telegramApi.sendMessage(message.chatId, buildHelpMessage());
      return { kind: "help" };
    }

    if (classification.kind === "status") {
      return this.#handleStatusCommand(message.chatId);
    }

    if (classification.kind === "interrupt") {
      return this.#handleInterruptCommand(message.chatId);
    }

    if (classification.kind === "changes") {
      return this.#handleChangesCommand(message.chatId);
    }

    if (classification.kind === "last-error") {
      return this.#handleLastErrorCommand(message.chatId);
    }

    if (classification.kind === "permission") {
      return this.#handlePermissionCommand(message.chatId, classification.permissionLevel);
    }

    if (classification.kind === "detach") {
      await this.interactivePrompts.interruptAll(message.chatId);
      await this.detach(message.chatId);
      await this.#dropQueuedJobsForChat(
        message.chatId,
        buildDrainingMessage(this.shutdownSource),
      );
      this.pendingByChat.delete(message.chatId);
      await this.telegramApi.sendMessage(
        message.chatId,
        "Telegram relay detached. Continue in Codex or attach another thread later.",
      );
      return { kind: "detach" };
    }

    if (pendingInteractive) {
      return this.#handleInteractiveReply(message.chatId, message.text);
    }

    if (this.#isDraining()) {
      await this.telegramApi.sendMessage(message.chatId, buildDrainingMessage(this.shutdownSource));
      return {
        kind: "draining",
        completion: Promise.resolve({ dropped: true }),
      };
    }

    const binding = await getBinding(this.statePath, message.chatId);
    if (!binding) {
      await this.telegramApi.sendMessage(
        message.chatId,
        "No Codex thread is attached to this Telegram chat yet.",
      );
      return { kind: "missing-binding" };
    }

    if (!this.#hasReadySessionForBinding(binding)) {
      await this.telegramApi.sendMessage(
        message.chatId,
        "Bridge 会话未就绪。请回到 Codex 重新 attach 当前 thread。",
      );
      return {
        kind: "degraded",
        completion: Promise.resolve({ degraded: true }),
      };
    }

    const blockingTurn = await this.#inspectAttachedThreadTurn(binding, message.chatId);
    const shouldQueue = this.processingChats.has(message.chatId) || Boolean(blockingTurn);

    const completion = new Promise((resolve, reject) => {
      const queue = this.pendingByChat.get(message.chatId) ?? [];
      queue.push(createRelayJob(message.text, { resolve, reject }));
      this.pendingByChat.set(message.chatId, queue);
    });

    if (shouldQueue) {
      await this.telegramApi.sendMessage(
        message.chatId,
        "（codex还在运行上一个turn，结束后消息会送达codex）",
      );
    }

    this.#startWorker(message.chatId);

    return {
      kind: shouldQueue ? "queued" : "relay",
      completion,
    };
  }

  async #handleInteractiveReply(chatId, text) {
    const result = await this.interactivePrompts.handleReply(chatId, text);
    return {
      kind: "interactive-response",
      completion: Promise.resolve(result),
    };
  }

  async #handlePermissionCommand(chatId, permissionLevel) {
    const binding = await getBinding(this.statePath, chatId);
    if (!binding) {
      await this.telegramApi.sendMessage(
        chatId,
        "No Codex thread is attached to this Telegram chat yet.",
      );
      return { kind: "missing-binding" };
    }

    if (!permissionLevel) {
      await this.telegramApi.sendMessage(
        chatId,
        `当前权限: ${describeAccessSummary(binding.access)}`,
        {
          reply_markup: buildPermissionChooser(),
        },
      );
      return { kind: "permission" };
    }

    const updatedBinding = await updateBinding(this.statePath, chatId, (existingBinding) => ({
      ...existingBinding,
      access: applyPermissionLevel({
        level: permissionLevel,
        accessState: existingBinding.access,
        cwd: existingBinding.cwd,
      }),
    }));

    await this.telegramApi.sendMessage(
      chatId,
      `权限已切换到 ${permissionLevel}。\n当前权限: ${describeAccessSummary(updatedBinding.access)}`,
    );
    return { kind: "permission" };
  }

  async #handleStatusCommand(chatId) {
    const binding = await getBinding(this.statePath, chatId);
    const runtimeStatus = await this.getRuntimeStatus();
    const lastError = await getLastRelayRecord(this.statePath, chatId);
    let activeRelay =
      runtimeStatus.activeRelays?.find((relay) => relay.chatId === chatId) ??
      this.#formatAttachedSessionTurn(runtimeStatus.attachedSession?.activeTurn) ??
      null;
    let observedExternalTurn = null;

    if (!activeRelay && binding && this.codexClient?.inspectActiveTurn) {
      const inProgressTurn = await this.codexClient.inspectActiveTurn(binding.threadId);
      if (inProgressTurn) {
        activeRelay = {
          chatId,
          threadId: binding.threadId,
          turnId: inProgressTurn.id ?? null,
          inProgress: true,
        };
      }
    }

    if (!activeRelay && binding && runtimeStatus.mode === "degraded" && this.codexClient?.inspectActiveTurn) {
      const inProgressTurn = await this.codexClient.inspectActiveTurn(binding.threadId);
      if (inProgressTurn) {
        observedExternalTurn = {
          turnId: inProgressTurn.id ?? null,
          threadId: binding.threadId,
        };
      }
    }

    await this.telegramApi.sendMessage(
      chatId,
      buildStatusMessage({
        binding,
        runtimeStatus,
        lastError,
        activeRelay,
        observedExternalTurn,
      }),
    );
    return { kind: "status" };
  }

  async #handleInterruptCommand(chatId) {
    const binding = await getBinding(this.statePath, chatId);
    if (!binding) {
      await this.telegramApi.sendMessage(
        chatId,
        "No Codex thread is attached to this Telegram chat yet.",
      );
      return { kind: "missing-binding" };
    }

    const activePrompt = this.interactivePrompts.getActive(chatId);
    if (activePrompt) {
      await this.interactivePrompts.interruptAll(chatId);
      await this.#dropQueuedJobsForChat(
        chatId,
        "当前运行已中断，排队消息已清空，请重新发送你想继续的内容。",
      );
      this.pendingByChat.delete(chatId);
      await this.telegramApi.sendMessage(chatId, "已中断当前运行中的 turn，请重新发送消息。");
      return {
        kind: "interrupt",
        completion: Promise.resolve({ interrupted: true }),
      };
    }

    if (!this.#hasReadySessionForBinding(binding)) {
      await this.telegramApi.sendMessage(
        chatId,
        "Bridge 会话未就绪，无法中断当前 turn。请回到 Codex 重新 attach。",
      );
      return { kind: "interrupt" };
    }

    let activeRelay =
      this.activeRelays.get(chatId) ??
      this.#formatAttachedSessionTurn(this.attachedSession?.activeTurn) ??
      null;

    if (!activeRelay && this.codexClient?.inspectActiveTurn) {
      const inProgressTurn = await this.codexClient.inspectActiveTurn(binding.threadId);
      if (inProgressTurn) {
        activeRelay = {
          chatId,
          threadId: binding.threadId,
          turnId: inProgressTurn.id ?? null,
          inProgress: true,
        };
        this.#setAttachedSessionObservedTurn(activeRelay);
      }
    }

    if (!activeRelay) {
      await this.telegramApi.sendMessage(chatId, "当前没有可中断的运行中 turn。");
      return { kind: "interrupt" };
    }

    if (!activeRelay.turnId) {
      await this.telegramApi.sendMessage(
        chatId,
        "当前 turn 尚未拿到可中断的 id，请稍后重试。",
      );
      return { kind: "interrupt" };
    }

    try {
      await this.codexClient?.interruptTurn?.({
        threadId: activeRelay.threadId,
        turnId: activeRelay.turnId,
      });
    } catch (error) {
      if (isThreadSessionLostError(error)) {
        this.#markAttachedSessionDegraded("thread_session_not_ready");
        await this.telegramApi.sendMessage(
          chatId,
          "Bridge 会话未就绪，无法中断当前 turn。请回到 Codex 重新 attach。",
        );
        return { kind: "interrupt" };
      }
      throw error;
    }
    await this.#dropQueuedJobsForChat(
      chatId,
      "当前运行已中断，排队消息已清空，请重新发送你想继续的内容。",
    );
    this.pendingByChat.delete(chatId);
    await this.telegramApi.sendMessage(chatId, "已中断当前运行中的 turn，请重新发送消息。");
    return {
      kind: "interrupt",
      completion: Promise.resolve({ interrupted: true }),
    };
  }

  async #handleChangesCommand(chatId) {
    const binding = await getBinding(this.statePath, chatId);
    if (!binding) {
      await this.telegramApi.sendMessage(
        chatId,
        "No Codex thread is attached to this Telegram chat yet.",
      );
      return { kind: "missing-binding" };
    }

    try {
      const changes = await this.readWorkspaceChanges(binding.cwd ?? null);
      await this.telegramApi.sendMessage(
        chatId,
        buildChangesMessage({ cwd: binding.cwd, changes }),
      );
      return { kind: "changes" };
    } catch (error) {
      await this.#recordLastError(chatId, {
        scope: "changes",
        message: error.message ?? String(error),
      });
      await this.telegramApi.sendMessage(
        chatId,
        `无法读取工作区变更: ${error.message ?? String(error)}`,
      );
      return { kind: "changes" };
    }
  }

  async #handleLastErrorCommand(chatId) {
    const lastError = await getLastRelayRecord(this.statePath, chatId);
    await this.telegramApi.sendMessage(chatId, buildLastErrorMessage(lastError));
    return { kind: "last-error" };
  }

  #startWorker(chatId) {
    if (this.processingChats.has(chatId)) {
      return;
    }

    this.mode = this.shutdownRequested ? "draining" : "busy";
    this.shouldExit = this.shutdownRequested;
    this.processingChats.add(chatId);
    void this.#runWorker(chatId).finally(() => {
      void this.#handleWorkerCompletion(chatId).catch(() => {});
    });
  }

  async #runWorker(chatId) {
    while ((this.pendingByChat.get(chatId) ?? []).length > 0) {
      const queue = this.pendingByChat.get(chatId) ?? [];
      const job = queue.shift();
      this.pendingByChat.set(chatId, queue);

      if (!job) {
        return;
      }

      try {
        const binding = await getBinding(this.statePath, chatId);
        if (!binding) {
          throw new Error("No active binding for this Telegram chat.");
        }
        if (!this.#hasReadySessionForBinding(binding)) {
          const error = new Error("Bridge session is not ready for the attached thread.");
          error.code = "THREAD_SESSION_NOT_READY";
          throw error;
        }

        await this.#waitForAttachedThreadToBeIdle(binding, chatId);
        if (this.shutdownRequested) {
          await this.#finalizeShutdownBeforeSettling(chatId);
          try {
            await this.progressTracker.sendBestEffortMessage(
              chatId,
              buildDrainingMessage(this.shutdownSource),
            );
          } finally {
            job.resolve({
              dropped: true,
            });
          }
          continue;
        }

        job.workStartedAt = this.nowFn();
        const activeRelay = {
          chatId,
          threadId: binding.threadId,
          turnId: null,
          startedAt: job.workStartedAt,
          textPreview: job.text,
        };
        this.#setAttachedSessionActiveTurn(activeRelay);
        this.activeRelays.set(chatId, activeRelay);
        const typing = this.progressTracker.startTyping(chatId);
        const effectiveAccess = resolveEffectiveAccess(binding.access);
        try {
          const result = await this.codexClient.relayText({
            threadId: binding.threadId,
            text: job.text,
            cwd: binding.cwd ?? undefined,
            approvalPolicy: effectiveAccess.approvalPolicy,
            sandboxPolicy: effectiveAccess.sandboxPolicy,
            onProgress: async (progressText) => {
              await this.progressTracker.updateProgressMessage(chatId, job, progressText);
            },
            onInteractiveRequest: async (request) =>
              this.interactivePrompts.enqueue({ chatId, request, typing }),
            onInteractiveRequestResolved: async ({ requestId }) => {
              this.interactivePrompts.clearRequest(chatId, requestId);
            },
            onTurnStarted: async ({ turnId }) => {
              activeRelay.turnId = turnId;
              this.#setAttachedSessionActiveTurn(activeRelay);
            },
          });
          await this.progressTracker.flushPendingProgress(chatId, job, { allowInitialSend: false });
          if (result.text) {
            await this.telegramApi.sendMessage(chatId, result.text);
          }
          await this.#finalizeShutdownBeforeSettling(chatId);
          job.resolve(result);
        } finally {
          this.activeRelays.delete(chatId);
          this.#clearAttachedSessionActiveTurn();
          typing.stop();
        }
      } catch (error) {
        await this.progressTracker.flushPendingProgress(chatId, job, { allowInitialSend: false });
        if (error?.code === "TURN_INTERRUPTED") {
          await this.#finalizeShutdownBeforeSettling(chatId);
          job.resolve({
            interrupted: true,
          });
        } else if (isThreadSessionLostError(error)) {
          this.#markAttachedSessionDegraded("thread_session_not_ready");
          await this.#recordLastError(chatId, {
            scope: "relay",
            message: "Bridge session is not ready for the attached thread.",
          });
          await this.#finalizeShutdownBeforeSettling(chatId);
          await this.progressTracker.sendBestEffortMessage(
            chatId,
            "Bridge 会话未就绪。请回到 Codex 重新 attach 当前 thread。",
          );
          job.reject(error);
        } else {
          await this.#recordLastError(chatId, {
            scope: "relay",
            message: error.message ?? String(error),
          });
          await this.#finalizeShutdownBeforeSettling(chatId);
          await this.progressTracker.sendBestEffortMessage(
            chatId,
            `Telegram relay error: ${error.message ?? String(error)}`,
          );
          job.reject(error);
        }
      }
    }
  }

  async #recordLastError(chatId, { scope, message }) {
    await updateLastRelayRecord(this.statePath, chatId, () => ({
      scope: scope ?? "unknown",
      message,
      at: new Date().toISOString(),
    }));
  }

  async #dropQueuedJobs(messageText) {
    for (const [chatId, queue] of this.pendingByChat.entries()) {
      await this.#dropQueuedJobsForChat(chatId, messageText, queue);
      this.pendingByChat.set(chatId, queue);
    }
  }

  async #dropQueuedJobsForChat(chatId, messageText, existingQueue = null) {
    const queue = existingQueue ?? this.pendingByChat.get(chatId) ?? [];
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) {
        continue;
      }

      try {
        await this.telegramApi?.sendMessage?.(chatId, messageText);
      } catch {
      } finally {
        job.resolve({
          dropped: true,
        });
      }
    }
  }

  async #handleWorkerCompletion(chatId) {
    this.processingChats.delete(chatId);
    if (!this.shutdownRequested && (this.pendingByChat.get(chatId) ?? []).length > 0) {
      this.#startWorker(chatId);
      return;
    }

    await this.#refreshModeAfterWork();
  }

  async #refreshModeAfterWork() {
    if (this.mode === "ready_to_stop") {
      this.shouldExit = true;
      return;
    }

    if (this.processingChats.size > 0) {
      this.mode = this.shutdownRequested ? "draining" : "busy";
      return;
    }

    if (this.shutdownRequested) {
      await this.#transitionToReadyToStop();
      return;
    }

    this.mode = "idle";
  }

  #getQueueDepth() {
    let queueDepth = 0;
    for (const queue of this.pendingByChat.values()) {
      queueDepth += queue.length;
    }
    return queueDepth;
  }

  #isDraining() {
    return this.mode === "draining" || this.shutdownRequested;
  }

  async #syncShutdownIntentFromBindings() {
    const state = await readState(this.statePath);
    const activeBindingCount = Object.keys(state.activeBindings ?? {}).length;
    if (activeBindingCount > 0) {
      return;
    }

    this.shutdownRequested = true;
    this.shutdownSource = "no_bindings";
    this.shouldExit = true;
    if (this.processingChats.size > 0) {
      this.mode = "draining";
      return;
    }

    this.mode = "ready_to_stop";
  }

  async #transitionToReadyToStop() {
    this.mode = "ready_to_stop";
    this.shouldExit = true;
    this.#clearAttachedSession();
    await clearAllBindings(this.statePath);
  }

  async #finalizeShutdownBeforeSettling(chatId) {
    const queueDepthForChat = (this.pendingByChat.get(chatId) ?? []).length;
    if (!this.shutdownRequested || queueDepthForChat > 0 || this.processingChats.size !== 1) {
      return;
    }

    await this.#transitionToReadyToStop();
  }

  #hasReadySessionForBinding(binding) {
    const clientSession = this.codexClient?.getAttachedThreadSession?.() ?? null;
    const clientSessionMatches =
      typeof this.codexClient?.getAttachedThreadSession !== "function" ||
      (clientSession?.sessionReady !== false && clientSession?.threadId === binding?.threadId);
    return Boolean(
      binding &&
        this.attachedSession?.sessionReady &&
        this.attachedSession.chatId === binding.chatId &&
        this.attachedSession.threadId === binding.threadId &&
        clientSessionMatches,
    );
  }

  #syncAttachedSessionMetadata(binding) {
    if (!this.#hasReadySessionForBinding(binding)) {
      return;
    }

    this.attachedSession = {
      ...this.attachedSession,
      threadLabel: binding.threadLabel ?? this.attachedSession.threadLabel,
      cwd: binding.cwd ?? this.attachedSession.cwd,
      access: binding.access ?? this.attachedSession.access,
      effectiveAccess: resolveEffectiveAccess(binding.access ?? this.attachedSession.access),
    };
  }

  #setAttachedSessionActiveTurn(activeTurn) {
    if (!this.attachedSession?.sessionReady) {
      return;
    }
    this.attachedSession = {
      ...this.attachedSession,
      activeTurn: {
        chatId: activeTurn.chatId,
        threadId: activeTurn.threadId,
        turnId: activeTurn.turnId ?? null,
        startedAt: activeTurn.startedAt,
        textPreview: activeTurn.textPreview ?? null,
        source: "bridge",
      },
    };
  }

  #clearAttachedSessionActiveTurn() {
    if (!this.attachedSession) {
      return;
    }
    this.attachedSession = {
      ...this.attachedSession,
      activeTurn: null,
    };
  }

  #setAttachedSessionObservedTurn(activeTurn) {
    if (!this.attachedSession?.sessionReady) {
      return;
    }
    this.attachedSession = {
      ...this.attachedSession,
      activeTurn: {
        chatId: activeTurn.chatId,
        threadId: activeTurn.threadId,
        turnId: activeTurn.turnId ?? null,
        startedAt: activeTurn.startedAt ?? null,
        textPreview: activeTurn.textPreview ?? null,
        source: activeTurn.source ?? "attached-thread",
        inProgress: activeTurn.inProgress ?? true,
      },
    };
  }

  #markAttachedSessionDegraded(reason) {
    if (!this.attachedSession) {
      return;
    }
    this.attachedSession = {
      ...this.attachedSession,
      sessionReady: false,
      degradedReason: reason ?? "unknown",
      activeTurn: null,
    };
    this.codexClient?.clearAttachedThreadSession?.();
  }

  #clearAttachedSession() {
    this.attachedSession = null;
    this.codexClient?.clearAttachedThreadSession?.();
  }

  #deriveMode(state) {
    if (this.mode === "ready_to_stop") {
      return "ready_to_stop";
    }
    if (this.shutdownRequested) {
      return this.processingChats.size > 0 ? "draining" : "ready_to_stop";
    }
    if (this.processingChats.size > 0) {
      return "busy";
    }
    const activeBindings = Object.values(state.activeBindings ?? {});
    if (
      activeBindings.length > 0 &&
      !activeBindings.some((binding) => this.#hasReadySessionForBinding(binding))
    ) {
      return "degraded";
    }
    return "idle";
  }

  async #waitForAttachedThreadToBeIdle(binding, chatId) {
    while (true) {
      const inProgressTurn = await this.#inspectAttachedThreadTurn(binding, chatId);
      if (!inProgressTurn) {
        return;
      }
      await this.waitFn(this.threadPollIntervalMs);
    }
  }

  async #inspectAttachedThreadTurn(binding, chatId) {
    if (!binding || !this.codexClient?.inspectActiveTurn) {
      return null;
    }

    const inProgressTurn = await this.codexClient.inspectActiveTurn(binding.threadId);
    if (!inProgressTurn) {
      const activeTurn = this.attachedSession?.activeTurn;
      if (activeTurn?.source === "attached-thread") {
        this.#clearAttachedSessionActiveTurn();
      }
      return null;
    }

    const observedTurn = {
      chatId,
      threadId: binding.threadId,
      turnId: inProgressTurn.id ?? null,
      startedAt: null,
      textPreview: null,
      source: "attached-thread",
      inProgress: true,
    };
    this.#setAttachedSessionObservedTurn(observedTurn);
    return observedTurn;
  }

  #formatAttachedSessionTurn(activeTurn) {
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
      runningForMs:
        typeof activeTurn.startedAt === "number" ? this.nowFn() - activeTurn.startedAt : undefined,
    };
  }
}

function createAttachedSession({ binding, effectiveAccess, sessionStartedAt }) {
  return {
    chatId: binding.chatId,
    threadId: binding.threadId,
    threadLabel: binding.threadLabel ?? null,
    cwd: binding.cwd ?? null,
    access: binding.access ?? null,
    effectiveAccess,
    sessionReady: true,
    sessionStartedAt,
    degradedReason: null,
    activeTurn: null,
  };
}

const DRAINING_MESSAGE = "Bridge shutdown in progress. Please return to Codex and re-attach later.";

function buildDrainingMessage(source) {
  const sourceLabel = formatShutdownSource(source);
  if (!sourceLabel) {
    return DRAINING_MESSAGE;
  }
  return `${DRAINING_MESSAGE} (requested from ${sourceLabel})`;
}

function isThreadSessionLostError(error) {
  if (error?.code === "THREAD_SESSION_NOT_READY") {
    return true;
  }
  return /thread not found|attached thread session is not ready/i.test(error?.message ?? "");
}

function formatShutdownSource(source) {
  switch (`${source ?? ""}`.trim().toLowerCase()) {
    case "tray":
      return "tray";
    case "cli":
      return "cli";
    case "no_bindings":
      return "binding cleanup";
    case "unknown":
    case "":
      return null;
    default:
      return source;
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildPermissionChooser() {
  return {
    inline_keyboard: [
      [
        { text: "default", callback_data: "permission:default" },
        { text: "readonly", callback_data: "permission:readonly" },
      ],
      [
        { text: "workspace", callback_data: "permission:workspace" },
        { text: "full", callback_data: "permission:full" },
      ],
    ],
  };
}
