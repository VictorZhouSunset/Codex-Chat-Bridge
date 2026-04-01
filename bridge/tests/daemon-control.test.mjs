import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureBridgeRunning,
  fetchBridgeStatus,
  isBridgeHealthy,
  stopBridge,
} from "../src/daemon-control.mjs";

test("isBridgeHealthy returns false when the health endpoint fails", async () => {
  const healthy = await isBridgeHealthy({
    controlPort: 47821,
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(healthy, false);
});

test("ensureBridgeRunning starts the bridge when health checks fail", async () => {
  const calls = [];
  let attempt = 0;

  await ensureBridgeRunning({
    controlPort: 47821,
    fetchImpl: async () => {
      attempt += 1;
      return {
        ok: attempt >= 3,
      };
    },
    startFn: async () => {
      calls.push("start");
    },
    sleepFn: async () => {
      calls.push("sleep");
    },
    maxAttempts: 5,
  });

  assert.deepEqual(calls, ["start", "sleep"]);
});

test("ensureBridgeRunning does not start a second bridge when health is already ok", async () => {
  let started = false;

  await ensureBridgeRunning({
    controlPort: 47821,
    fetchImpl: async () => ({ ok: true }),
    startFn: async () => {
      started = true;
    },
    sleepFn: async () => {},
  });

  assert.equal(started, false);
});

test("stopBridge calls the shutdown endpoint with an optional source", async () => {
  const requests = [];

  await stopBridge({
    controlPort: 47821,
    source: "cli",
    fetchImpl: async (url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ?? null,
      });
      return { ok: true };
    },
  });

  assert.deepEqual(requests, [
    {
      url: "http://127.0.0.1:47821/shutdown",
      method: "POST",
      body: JSON.stringify({ source: "cli" }),
    },
  ]);
});

test("fetchBridgeStatus returns parsed live bridge runtime state", async () => {
  const status = await fetchBridgeStatus({
    controlPort: 47821,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          ok: true,
          mode: "draining",
          queueDepth: 2,
          pendingInteractiveCount: 1,
          shutdownSource: "tray",
          binding: {
            chatId: "1001",
            threadId: "thread-a",
          },
        };
      },
    }),
  });

  assert.deepEqual(status, {
    ok: true,
    mode: "draining",
    queueDepth: 2,
    pendingInteractiveCount: 1,
    shutdownSource: "tray",
    binding: {
      chatId: "1001",
      threadId: "thread-a",
    },
  });
});
