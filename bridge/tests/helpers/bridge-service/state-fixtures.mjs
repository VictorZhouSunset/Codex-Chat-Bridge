// input: bridge runtime test contexts that need temp state paths, manual clocks, and task flushing helpers
// output: deterministic filesystem and timing fixtures for bridge-service-focused tests
// pos: shared state and timing helper module for bridge-service test support
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

export function createManualClock(startMs = 0) {
  let nowMs = startMs;
  let nextTimerId = 1;
  const timers = new Map();

  return {
    now() {
      return nowMs;
    },
    setTimeoutFn(callback, delayMs) {
      const timerId = nextTimerId++;
      timers.set(timerId, {
        callback,
        runAt: nowMs + Math.max(0, delayMs),
      });
      return timerId;
    },
    clearTimeoutFn(timerId) {
      timers.delete(timerId);
    },
    async advance(ms) {
      nowMs += ms;
      while (true) {
        const dueTimers = [...timers.entries()]
          .filter(([, timer]) => timer.runAt <= nowMs)
          .sort((left, right) => left[1].runAt - right[1].runAt);

        if (dueTimers.length === 0) {
          break;
        }

        for (const [timerId, timer] of dueTimers) {
          timers.delete(timerId);
          timer.callback();
        }

        await Promise.resolve();
      }
    },
  };
}

export async function waitForNextTask() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function createTestStatePath(t) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tg-bridge-service-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  return path.join(tempDir, "state.json");
}
