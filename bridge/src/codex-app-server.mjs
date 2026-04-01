// input: Codex app-server JSON-RPC streams, thread ids, turn input text, and runtime callbacks
// output: resumed threads, relayed turn results, progress updates, and normalized interactive requests
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
    this.started = false;
  }

  async start() {
    if (this.started) {
      return;
    }

    this.process = this.processFactory();
    this.process.stderr?.on("data", () => {});

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

  async readThread(threadId) {
    const result = await this.request("thread/read", {
      threadId,
      includeTurns: false,
    });
    return result.thread;
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
    approvalPolicy,
    sandboxPolicy,
    cwd,
  }) {
    await this.resumeThread(threadId, {
      approvalPolicy,
      sandboxPolicy,
      cwd,
    });

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

    return turnPromise;
  }

  async interruptTurn({ threadId, turnId }) {
    return this.request("turn/interrupt", {
      threadId,
      turnId,
    });
  }

  async close() {
    if (!this.process) {
      return;
    }
    this.process.stdin?.end();
    this.process.kill?.();
    this.started = false;
  }

  request(method, params) {
    const id = ++this.requestId;
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
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
