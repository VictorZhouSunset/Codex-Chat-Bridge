import http from "node:http";

import { readState } from "./binding-store.mjs";

export async function resolveControlResponse({
  method,
  url,
  body,
  bridgeService,
  readStateFn = readState,
}) {
  const pathName = getPathName(url);

  if (method === "GET" && pathName === "/health") {
    return {
      statusCode: 200,
      body: { ok: true },
    };
  }

  if (method === "GET" && pathName === "/status") {
    return {
      statusCode: 200,
      body: await buildStatusBody({ bridgeService, readStateFn }),
    };
  }

  if (method === "POST" && pathName === "/shutdown") {
    const shutdownBody = normalizeJsonBody(body);
    await bridgeService.requestShutdown(shutdownBody.source, {
      force: shutdownBody.force === true,
    });
    const statusBody = await buildStatusBody({ bridgeService, readStateFn });
    return {
      statusCode: 200,
      body: {
        ...statusBody,
        safeToStop: !shouldKeepServing(statusBody),
      },
    };
  }

  if (method === "POST" && pathName === "/attach") {
    const attachBody = normalizeJsonBody(body);
    try {
      const binding = await bridgeService.attach({
        chatId: attachBody.chatId,
        threadId: attachBody.threadId,
        threadLabel: attachBody.threadLabel ?? null,
        cwd: attachBody.cwd ?? null,
        access: attachBody.access ?? null,
      });
      return {
        statusCode: 200,
        body: {
          ok: true,
          binding,
        },
      };
    } catch (error) {
      return buildErrorResponse(error);
    }
  }

  if (method === "POST" && pathName === "/detach") {
    const detachBody = normalizeJsonBody(body);
    await bridgeService.detach(detachBody.chatId);
    return {
      statusCode: 200,
      body: {
        ok: true,
      },
    };
  }

  return {
    statusCode: 404,
    body: { ok: false },
  };
}

export function shouldKeepServing(runtime) {
  return runtime?.mode !== "ready_to_stop";
}

export function createControlServer({ bridgeService, readStateFn = readState }) {
  return http.createServer(async (request, response) => {
    try {
      const requestBody = await readRequestBody(request);
      const result = await resolveControlResponse({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        body: requestBody,
        bridgeService,
        readStateFn,
      });

      response.writeHead(result.statusCode, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(result.body));
    } catch (error) {
      response.writeHead(500, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ ok: false, error: error.message ?? String(error) }));
    }
  });
}

async function buildStatusBody({ bridgeService, readStateFn }) {
  const runtime = await bridgeService.getRuntimeStatus();
  const bindings = await getBindingMetadata({
    statePath: bridgeService.statePath,
    readStateFn,
  });

  return {
    ok: true,
    mode: runtime.mode,
    queueDepth: runtime.queueDepth,
    pendingInteractiveCount: runtime.pendingInteractiveCount ?? 0,
    shutdownSource: runtime.shutdownSource ?? null,
    attachedSession: runtime.attachedSession ?? null,
    activeRelays: runtime.activeRelays ?? [],
    binding: bindings[0] ?? null,
    bindings,
  };
}

async function getBindingMetadata({ statePath, readStateFn }) {
  if (!statePath) {
    return [];
  }

  const state = await readStateFn(statePath);
  const bindings = Object.values(state.activeBindings ?? {});
  if (bindings.length === 0) {
    return [];
  }

  return bindings.sort(compareBindingsByAttachedAtDesc);
}

function getPathName(url) {
  try {
    return new URL(url, "http://127.0.0.1").pathname;
  } catch {
    return url;
  }
}

function normalizeJsonBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === "object") {
    return body;
  }

  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function buildErrorResponse(error) {
  if (error?.code === "BINDING_CONFLICT") {
    return {
      statusCode: 409,
      body: {
        ok: false,
        error: error.message ?? String(error),
        code: error.code,
        binding: error.binding ?? null,
      },
    };
  }

  throw error;
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function compareBindingsByAttachedAtDesc(left, right) {
  const leftTimestamp = Date.parse(left.attachedAt ?? "");
  const rightTimestamp = Date.parse(right.attachedAt ?? "");

  if (Number.isNaN(leftTimestamp) && Number.isNaN(rightTimestamp)) {
    return 0;
  }

  if (Number.isNaN(leftTimestamp)) {
    return 1;
  }

  if (Number.isNaN(rightTimestamp)) {
    return -1;
  }

  return rightTimestamp - leftTimestamp;
}
