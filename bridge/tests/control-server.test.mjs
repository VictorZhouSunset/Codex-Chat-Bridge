import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { createEmptyState, writeState } from "../src/binding-store.mjs";
import {
  resolveControlResponse,
  shouldKeepServing,
} from "../src/control-server.mjs";

async function createStatePath(state) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tg-bridge-control-"));
  const statePath = path.join(tempDir, "state.json");
  await writeState(statePath, state);
  return statePath;
}

test("GET /status returns runtime mode, queue depth, pending interactive count, and current binding metadata", async () => {
  const statePath = await createStatePath({
    ...createEmptyState(),
    activeBindings: {
      "1001": {
        chatId: "1001",
        threadId: "thread-123",
        threadLabel: "Project A",
        cwd: "D:\\project-a",
        attachedAt: "2026-03-27T16:00:00.000Z",
      },
      "1002": {
        chatId: "1002",
        threadId: "thread-456",
        threadLabel: "Project B",
        cwd: "D:\\project-b",
        attachedAt: "2026-03-27T15:00:00.000Z",
      },
    },
  });

  const bridgeService = {
    statePath,
    async getRuntimeStatus() {
      return {
        mode: "busy",
        queueDepth: 2,
        pendingInteractiveCount: 1,
        shutdownSource: "tray",
      };
    },
  };

  const response = await resolveControlResponse({
    method: "GET",
    url: "/status",
    bridgeService,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    mode: "busy",
    queueDepth: 2,
    pendingInteractiveCount: 1,
    shutdownSource: "tray",
    binding: {
      chatId: "1001",
      threadId: "thread-123",
      threadLabel: "Project A",
      cwd: "D:\\project-a",
      attachedAt: "2026-03-27T16:00:00.000Z",
    },
    bindings: [
      {
        chatId: "1001",
        threadId: "thread-123",
        threadLabel: "Project A",
        cwd: "D:\\project-a",
        attachedAt: "2026-03-27T16:00:00.000Z",
      },
      {
        chatId: "1002",
        threadId: "thread-456",
        threadLabel: "Project B",
        cwd: "D:\\project-b",
        attachedAt: "2026-03-27T15:00:00.000Z",
      },
    ],
  });
});

test("POST /shutdown requests immediate shutdown when idle", async () => {
  let requested = null;
  const bridgeService = {
    async getRuntimeStatus() {
      return {
        mode: "ready_to_stop",
        queueDepth: 0,
      };
    },
    async requestShutdown(source) {
      requested = source;
      return this.getRuntimeStatus();
    },
  };

  const response = await resolveControlResponse({
    method: "POST",
    url: "/shutdown",
    body: { source: "cli" },
    bridgeService,
  });

  assert.equal(requested, "cli");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.mode, "ready_to_stop");
  assert.equal(response.body.safeToStop, true);
});

test("POST /shutdown enters draining when busy", async () => {
  let requested = null;
  const bridgeService = {
    async getRuntimeStatus() {
      return {
        mode: requested ? "draining" : "busy",
        queueDepth: 1,
        shutdownSource: requested,
      };
    },
    async requestShutdown(source) {
      requested = source;
      return this.getRuntimeStatus();
    },
  };

  const response = await resolveControlResponse({
    method: "POST",
    url: "/shutdown",
    body: { source: "tray" },
    bridgeService,
  });

  assert.equal(requested, "tray");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.mode, "draining");
  assert.equal(response.body.shutdownSource, "tray");
  assert.equal(response.body.safeToStop, false);
});

test("the serve loop keeps running until the bridge reports ready_to_stop", () => {
  assert.equal(shouldKeepServing({ mode: "busy" }), true);
  assert.equal(shouldKeepServing({ mode: "draining" }), true);
  assert.equal(shouldKeepServing({ mode: "ready_to_stop" }), false);
});
