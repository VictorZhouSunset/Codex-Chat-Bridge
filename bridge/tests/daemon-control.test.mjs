import test from "node:test";
import assert from "node:assert/strict";

import {
  attachBridgeBinding,
  detachBridgeBinding,
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

test("attachBridgeBinding posts the binding payload to the daemon and returns the live binding", async () => {
  const binding = await attachBridgeBinding({
    controlPort: 47821,
    binding: {
      chatId: "1001",
      threadId: "thread-a",
      threadLabel: "Project A",
      cwd: "/tmp/project-a",
      access: null,
    },
    fetchImpl: async (url, init) => {
      assert.equal(url, "http://127.0.0.1:47821/attach");
      assert.equal(init?.method, "POST");
      assert.equal(init?.headers?.["content-type"], "application/json");
      assert.deepEqual(JSON.parse(init?.body ?? "{}"), {
        chatId: "1001",
        threadId: "thread-a",
        threadLabel: "Project A",
        cwd: "/tmp/project-a",
        access: null,
      });
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            binding: {
              chatId: "1001",
              threadId: "thread-a",
            },
          };
        },
      };
    },
  });

  assert.deepEqual(binding, {
    chatId: "1001",
    threadId: "thread-a",
  });
});

test("detachBridgeBinding posts the target chat id to the daemon", async () => {
  const requests = [];

  await detachBridgeBinding({
    controlPort: 47821,
    chatId: "1001",
    fetchImpl: async (url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        headers: init?.headers ?? null,
        body: init?.body ?? null,
      });
      return { ok: true };
    },
  });

  assert.deepEqual(requests, [
    {
      url: "http://127.0.0.1:47821/detach",
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ chatId: "1001" }),
    },
  ]);
});
