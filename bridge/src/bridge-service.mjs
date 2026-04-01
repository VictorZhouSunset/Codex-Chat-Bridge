// input: Telegram messages, persisted bindings, Codex app-server client, Telegram API client
// output: relay queue progression, Telegram side effects, runtime status, and shutdown transitions
// pos: top-level runtime orchestrator for the Node bridge daemon
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import {
  attachBinding,
  clearAllBindings,
  detachBinding,
  ensureStateFile,
  getBinding,
  getLastRelayRecord,
  readState,
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
    this.threadPollIntervalMs = options.threadPollIntervalMs ?? 100;
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
    return attachBinding(this.statePath, binding);
  }

  async detach(chatId) {
    await ensureStateFile(this.statePath);
    await detachBinding(this.statePath, chatId);
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
    return {
      mode: this.mode,
      activeJobCount: this.processingChats.size,
      shutdownRequested: this.shutdownRequested,
      shutdownSource: this.shutdownSource,
      shouldExit: this.shouldExit,
      queueDepth: this.#getQueueDepth(),
      pendingInteractiveCount: this.interactivePrompts.getPendingCount(),
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

    const shouldQueue =
      this.processingChats.has(message.chatId) || (await this.#isThreadBusy(binding.threadId));

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
    await this.telegramApi.sendMessage(
      chatId,
      buildStatusMessage({ binding, runtimeStatus, lastError }),
    );
    return { kind: "status" };
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

  async #isThreadBusy(threadId) {
    if (!this.codexClient?.readThread) {
      return false;
    }

    const thread = await this.codexClient.readThread(threadId);
    return thread?.status === "inProgress";
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

        while (await this.#isThreadBusy(binding.threadId)) {
          await this.waitFn(this.threadPollIntervalMs);
        }

        job.workStartedAt = Date.now();
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
          });
          await this.progressTracker.flushPendingProgress(chatId, job, { allowInitialSend: false });
          if (result.text) {
            await this.telegramApi.sendMessage(chatId, result.text);
          }
          await this.#finalizeShutdownBeforeSettling(chatId);
          job.resolve(result);
        } finally {
          typing.stop();
        }
      } catch (error) {
        await this.progressTracker.flushPendingProgress(chatId, job, { allowInitialSend: false });
        if (error?.code === "TURN_INTERRUPTED") {
          await this.#finalizeShutdownBeforeSettling(chatId);
          job.resolve({
            interrupted: true,
          });
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
    await clearAllBindings(this.statePath);
  }

  async #finalizeShutdownBeforeSettling(chatId) {
    const queueDepthForChat = (this.pendingByChat.get(chatId) ?? []).length;
    if (!this.shutdownRequested || queueDepthForChat > 0 || this.processingChats.size !== 1) {
      return;
    }

    await this.#transitionToReadyToStop();
  }
}

const DRAINING_MESSAGE = "Bridge shutdown in progress. Please return to Codex and re-attach later.";

function buildDrainingMessage(source) {
  const sourceLabel = formatShutdownSource(source);
  if (!sourceLabel) {
    return DRAINING_MESSAGE;
  }
  return `${DRAINING_MESSAGE} (requested from ${sourceLabel})`;
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
