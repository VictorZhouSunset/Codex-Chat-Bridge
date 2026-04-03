// input: Codex app-server JSON-RPC streams, thread ids, turn input text, and runtime callbacks
// output: resumed threads, relayed turn results, active turn inspection, interruption hooks, progress updates, and normalized interactive requests
// pos: process adapter between the bridge runtime and the Codex app-server subprocess
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import readline from "node:readline";
import { spawn } from "node:child_process";

import {
  getItemId,
  normalizeServerRequest,
  toSandboxMode,
} from "./codex-app-server-protocol.mjs";
import { formatProgressText, summarizeThreadItem } from "./progress-summary.mjs";

export class CodexAppServerClient {
  constructor(options = {}) {
    this.processFactory = options.processFactory ?? defaultProcessFactory;
    this.process = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.pendingTurns = new Map();
    this.attachedThreadSession = null;
    this.started = false;
    this.interruptTimeoutMs = options.interruptTimeoutMs ?? 12_000;
  }

  async start() {
    if (this.started) {
      return;
    }

    this.process = this.processFactory();
    this.process.stderr?.on("data", () => {});
    this.process.on?.("error", (error) => {
      this.#failPendingOperations(error);
    });
    this.process.on?.("exit", () => {
      this.#failPendingOperations(new Error("Codex app-server process exited."));
    });

    const rl = readline.createInterface({ input: this.process.stdout });
    rl.on("line", (line) => {
      this.#handleLine(line);
    });

    await this.request("initialize", {
      clientInfo: {
        name: "telegram-codex-bridge",
        title: "Telegram Codex Bridge",
        version: "0.1.0",
      },
      capabilities: null,
    });
    this.started = true;
  }

  async readThread(threadId, options = {}) {
    const result = await this.request("thread/read", {
      threadId,
      includeTurns: options.includeTurns ?? false,
    });
    return result.thread;
  }

  async inspectActiveTurn(threadId) {
    const activity = await this.inspectThreadActivity(threadId);
    return activity.blockingTurn ?? null;
  }

  async inspectActiveTurns(threadId) {
    const thread = await this.readThread(threadId, { includeTurns: true });
    const turns = Array.isArray(thread?.turns) ? thread.turns : [];
    return turns
      .filter((turn) => turn?.status === "inProgress")
      .map((turn) => ({
        ...turn,
        textPreview: extractTurnTextPreview(turn),
      }));
  }

  async inspectThreadActivity(threadId) {
    const thread = await this.readThread(threadId, { includeTurns: true });
    const turns = Array.isArray(thread?.turns) ? thread.turns : [];
    const mappedTurns = turns.map((turn) => ({
      ...turn,
      textPreview: extractTurnTextPreview(turn),
    }));
    const latestTurn = mappedTurns.at(-1) ?? null;
    const inProgressTurns = mappedTurns.filter((turn) => turn?.status === "inProgress");
    const blockingTurn = latestTurn?.status === "inProgress" ? latestTurn : null;
    const lingeringTurns = inProgressTurns.filter((turn) => turn?.id !== blockingTurn?.id);
    return {
      latestTurn,
      blockingTurn,
      lingeringTurns,
      inProgressTurns,
    };
  }

  async getActiveTurn(threadId) {
    return this.inspectActiveTurn(threadId);
  }

  async attachThreadSession({ threadId, approvalPolicy, sandboxPolicy, cwd }) {
    await this.resumeThread(threadId, {
      approvalPolicy,
      sandboxPolicy,
      cwd,
    });
    this.attachedThreadSession = {
      threadId,
      approvalPolicy,
      sandboxPolicy,
      cwd: cwd ?? null,
      sessionReady: true,
    };
    return this.getAttachedThreadSession();
  }

  getAttachedThreadSession() {
    return this.attachedThreadSession ? { ...this.attachedThreadSession } : null;
  }

  clearAttachedThreadSession() {
    this.attachedThreadSession = null;
  }

  async resumeThread(threadId, overrides = {}) {
    return this.request("thread/resume", {
      threadId,
      persistExtendedHistory: false,
      ...(typeof overrides.approvalPolicy !== "undefined" ? { approvalPolicy: overrides.approvalPolicy } : {}),
      ...(typeof overrides.sandboxPolicy !== "undefined"
        ? { sandbox: toSandboxMode(overrides.sandboxPolicy) }
        : {}),
      ...(typeof overrides.cwd !== "undefined" ? { cwd: overrides.cwd } : {}),
    });
  }

  async relayText({
    threadId,
    text,
    onProgress,
    onInteractiveRequest,
    onInteractiveRequestResolved,
    onTurnStarted,
    approvalPolicy,
    sandboxPolicy,
    cwd,
  }) {
    this.#assertAttachedThreadSession(threadId);

    const turnPromise = new Promise((resolve, reject) => {
      this.pendingTurns.set(threadId, {
        text: "",
        turnId: null,
        activeItems: new Map(),
        serverRequests: new Map(),
        lastProgressText: null,
        onProgress,
        onInteractiveRequest,
        onInteractiveRequestResolved,
        resolve,
        reject,
      });
    });

    const result = await this.request("turn/start", {
      threadId,
      ...(typeof approvalPolicy !== "undefined" ? { approvalPolicy } : {}),
      ...(typeof sandboxPolicy !== "undefined" ? { sandboxPolicy } : {}),
      ...(typeof cwd !== "undefined" ? { cwd } : {}),
      input: [
        {
          type: "text",
          text,
          text_elements: [],
        },
      ],
    });

    const pendingTurn = this.pendingTurns.get(threadId);
    if (pendingTurn) {
      pendingTurn.turnId = result.turn.id;
    }
    await onTurnStarted?.({
      threadId,
      turnId: result.turn.id,
    });

    return turnPromise;
  }

  async interruptTurn({ threadId, turnId }) {
    this.#assertAttachedThreadSession(threadId);
    try {
      return await this.request(
        "turn/interrupt",
        {
          threadId,
          turnId,
        },
        { timeoutMs: this.interruptTimeoutMs },
      );
    } catch (error) {
      if (error?.code === "REQUEST_TIMEOUT") {
        const timeoutError = new Error("Interrupt request timed out while waiting for Codex app-server.");
        timeoutError.code = "INTERRUPT_TIMEOUT";
        throw timeoutError;
      }
      throw error;
    }
  }

  async interruptAllTurns({ threadId, turns = null }) {
    this.#assertAttachedThreadSession(threadId);
    const activeTurns = Array.isArray(turns) ? turns : await this.inspectActiveTurns(threadId);
    const uniqueTurnIds = [...new Set(activeTurns.map((turn) => turn?.id).filter(Boolean))];
    const results = await Promise.allSettled(
      uniqueTurnIds.map((turnId) => this.interruptTurn({ threadId, turnId })),
    );

    const interruptedTurnIds = [];
    const failures = [];
    for (let index = 0; index < uniqueTurnIds.length; index += 1) {
      const turnId = uniqueTurnIds[index];
      const result = results[index];
      if (result.status === "fulfilled") {
        interruptedTurnIds.push(turnId);
      } else {
        failures.push({
          turnId,
          error: result.reason,
        });
      }
    }

    return {
      threadId,
      totalTurns: uniqueTurnIds.length,
      interruptedTurnIds,
      failures,
    };
  }

  async close() {
    if (!this.process) {
      return;
    }
    this.#failPendingOperations(new Error("Codex app-server client closed."));
    this.process.stdin?.end();
    this.process.kill?.();
    this.clearAttachedThreadSession();
    this.started = false;
  }

  request(method, params, options = {}) {
    const id = ++this.requestId;
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const pendingRequest = { resolve, reject, timer: null };
      if (typeof options.timeoutMs === "number" && options.timeoutMs > 0) {
        pendingRequest.timer = setTimeout(() => {
          if (!this.pendingRequests.delete(id)) {
            return;
          }
          const timeoutError = new Error(
            `Codex app-server request ${method} timed out after ${options.timeoutMs}ms.`,
          );
          timeoutError.code = "REQUEST_TIMEOUT";
          reject(timeoutError);
        }, options.timeoutMs);
      }
      this.pendingRequests.set(id, pendingRequest);
      this.process.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  #handleLine(line) {
    if (!line.trim()) {
      return;
    }

    const message = JSON.parse(line);
    if (typeof message.id !== "undefined" && typeof message.method !== "undefined") {
      void this.#handleServerRequest(message);
      return;
    }

    if (typeof message.id !== "undefined") {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }
      this.pendingRequests.delete(message.id);
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "Unknown JSON-RPC error"));
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (message.method === "item/agentMessage/delta") {
      const pendingTurn = this.pendingTurns.get(message.params.threadId);
      if (pendingTurn) {
        pendingTurn.text += message.params.delta;
      }
      return;
    }

    if (message.method === "item/started") {
      const pendingTurn = this.pendingTurns.get(message.params.threadId);
      if (!pendingTurn) {
        return;
      }
      const itemId = getItemId(message.params);
      const summary = summarizeThreadItem(message.params.item);
      if (itemId && summary) {
        pendingTurn.activeItems.set(itemId, summary);
        this.#emitProgress(pendingTurn);
      }
      return;
    }

    if (message.method === "item/completed") {
      const pendingTurn = this.pendingTurns.get(message.params.threadId);
      if (!pendingTurn) {
        return;
      }
      const itemId = getItemId(message.params);
      if (itemId && pendingTurn.activeItems.delete(itemId)) {
        this.#emitProgress(pendingTurn);
      }
      return;
    }

    if (message.method === "turn/completed") {
      const pendingTurn = this.pendingTurns.get(message.params.threadId);
      if (!pendingTurn) {
        return;
      }
      this.pendingTurns.delete(message.params.threadId);
      pendingTurn.resolve({
        threadId: message.params.threadId,
        turnId: pendingTurn.turnId ?? message.params.turn.id,
        text: pendingTurn.text,
        status: message.params.turn?.status ?? "completed",
      });
      return;
    }

    if (message.method === "serverRequest/resolved") {
      const pendingTurn = this.pendingTurns.get(message.params.threadId);
      if (!pendingTurn) {
        return;
      }

      pendingTurn.serverRequests.delete(String(message.params.requestId));
      pendingTurn.onInteractiveRequestResolved?.({
        threadId: message.params.threadId,
        requestId: message.params.requestId,
      });
      return;
    }

    if (message.method === "error") {
      const pendingTurn = this.pendingTurns.get(message.params.threadId);
      if (pendingTurn) {
        this.pendingTurns.delete(message.params.threadId);
        pendingTurn.reject(new Error(message.params.message ?? "Codex app-server error"));
      }
    }
  }

  #failPendingOperations(error) {
    const failure =
      error instanceof Error ? error : new Error(error?.message ?? String(error ?? "Unknown process failure"));
    for (const [id, pending] of this.pendingRequests.entries()) {
      this.pendingRequests.delete(id);
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(failure);
    }
    for (const [threadId, pendingTurn] of this.pendingTurns.entries()) {
      this.pendingTurns.delete(threadId);
      pendingTurn.reject(failure);
    }
  }

  async #handleServerRequest(message) {
    const request = normalizeServerRequest(message);
    const pendingTurn = this.pendingTurns.get(request?.threadId ?? "");
    if (!request || !pendingTurn) {
      return;
    }

    pendingTurn.serverRequests.set(String(request.requestId), request);

    try {
      const response = await pendingTurn.onInteractiveRequest?.(request);
      if (typeof response !== "undefined") {
        this.#sendServerResponse(request.requestId, response);
        pendingTurn.serverRequests.delete(String(request.requestId));
      }
    } catch (error) {
      if (error?.code === "TURN_INTERRUPTED") {
        return;
      }

      this.#sendServerError(request.requestId, error?.message ?? "Server request handling failed");
      pendingTurn.serverRequests.delete(String(request.requestId));
    }
  }

  #emitProgress(pendingTurn) {
    if (!pendingTurn.onProgress || pendingTurn.activeItems.size === 0) {
      return;
    }

    const text = formatProgressText([...pendingTurn.activeItems.values()]);
    if (!text || text === pendingTurn.lastProgressText) {
      return;
    }

    pendingTurn.lastProgressText = text;
    void Promise.resolve(pendingTurn.onProgress(text)).catch(() => {});
  }

  #sendServerResponse(id, result) {
    this.process.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        result,
      })}\n`,
    );
  }

  #sendServerError(id, message) {
    this.process.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message,
        },
      })}\n`,
    );
  }

  #assertAttachedThreadSession(threadId) {
    if (
      !this.attachedThreadSession?.sessionReady ||
      this.attachedThreadSession.threadId !== threadId
    ) {
      const error = new Error(`Attached thread session is not ready for ${threadId}.`);
      error.code = "THREAD_SESSION_NOT_READY";
      throw error;
    }
  }
}

function extractTurnTextPreview(turn) {
  const text = findUserText(turn);
  if (!text) {
    return null;
  }
  return `${text}`.trim() || null;
}

function findUserText(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const items = Array.isArray(value.items) ? value.items : [];
  for (const item of items) {
    const itemType = `${item?.type ?? ""}`.toLowerCase();
    const itemRole = `${item?.role ?? ""}`.toLowerCase();
    if (itemType.includes("user") || itemRole === "user") {
      const direct = extractTextFromNode(item);
      if (direct) {
        return direct;
      }
    }
  }

  if (Array.isArray(value.input)) {
    for (const entry of value.input) {
      const direct = extractTextFromNode(entry);
      if (direct) {
        return direct;
      }
    }
  }

  return null;
}

function extractTextFromNode(node) {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (typeof node.text === "string" && node.text.trim()) {
    return node.text.trim();
  }

  if (Array.isArray(node.content)) {
    for (const part of node.content) {
      const nested = extractTextFromNode(part);
      if (nested) {
        return nested;
      }
    }
  }

  if (Array.isArray(node.text_elements)) {
    for (const part of node.text_elements) {
      const nested = extractTextFromNode(part);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function defaultProcessFactory() {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", "codex app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  }

  return spawn("codex", ["app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}
