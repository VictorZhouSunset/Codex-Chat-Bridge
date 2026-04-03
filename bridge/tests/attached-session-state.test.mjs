// input: attached-session snapshots, observed-thread turns, and interrupt-session probes
// output: verified state-tracking behavior for extracted bridge attached-session helpers
// pos: unit suite for bridge runtime attached-session state support
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { AttachedSessionState } from "../src/bridge-service/attached-session-state.mjs";

function createTracker() {
  const tracker = new AttachedSessionState({
    clearAttachedThreadSession() {},
    nowFn: () => 5_000,
  });
  tracker.startSession({
    binding: {
      chatId: "1001",
      threadId: "thread-123",
      threadLabel: "Project A",
      cwd: "D:\\project-a",
    },
    effectiveAccess: {
      approvalPolicy: "never",
      sandboxPolicy: { type: "danger-full-access" },
    },
    sessionStartedAt: 1_000,
    generation: 1,
  });
  return tracker;
}

test("setObservedTurns tracks blocking and lingering attached-thread turns with one epoch", () => {
  const tracker = createTracker();

  tracker.setObservedTurns({
    blockingTurn: {
      chatId: "1001",
      threadId: "thread-123",
      turnId: "turn-new",
      textPreview: "new turn",
      source: "attached-thread",
      inProgress: true,
    },
    lingeringTurns: [
      {
        chatId: "1001",
        threadId: "thread-123",
        turnId: "turn-old",
        textPreview: "old turn",
        source: "attached-thread",
        inProgress: true,
      },
    ],
  });

  const snapshot = tracker.getSnapshot();
  assert.equal(snapshot.activeTurn?.turnId, "turn-new");
  assert.equal(snapshot.activeTurns.length, 2);
  assert.equal(snapshot.lingeringTurns.length, 1);
  assert.equal(snapshot.activeTurn?.turnEpoch, snapshot.lingeringTurns[0].turnEpoch);
  assert.deepEqual(
    tracker.formatTurns(snapshot.activeTurns).map((turn) => turn.turnId),
    ["turn-old", "turn-new"],
  );
});

test("matchesInterruptSession requires the same attached turn set", () => {
  const tracker = createTracker();

  tracker.setObservedTurns({
    blockingTurn: {
      chatId: "1001",
      threadId: "thread-123",
      turnId: "turn-new",
      textPreview: "new turn",
      source: "attached-thread",
      inProgress: true,
    },
    lingeringTurns: [
      {
        chatId: "1001",
        threadId: "thread-123",
        turnId: "turn-old",
        textPreview: "old turn",
        source: "attached-thread",
        inProgress: true,
      },
    ],
  });

  assert.equal(
    tracker.matchesInterruptSession({
      generation: 1,
      chatId: "1001",
      threadId: "thread-123",
      turnEpoch: tracker.getSnapshot().turnEpoch,
      turnIdsKey: "turn-new|turn-old",
    }),
    true,
  );
  assert.equal(
    tracker.matchesInterruptSession({
      generation: 1,
      chatId: "1001",
      threadId: "thread-123",
      turnEpoch: tracker.getSnapshot().turnEpoch,
      turnIdsKey: "turn-new",
    }),
    false,
  );
});

test("clearObservedTurns clears lingering-only attached-thread observations when the thread becomes idle", () => {
  const tracker = createTracker();

  tracker.setObservedTurns({
    blockingTurn: null,
    lingeringTurns: [
      {
        chatId: "1001",
        threadId: "thread-123",
        turnId: "turn-old",
        textPreview: "old turn",
        source: "attached-thread",
        inProgress: true,
      },
    ],
  });

  tracker.setObservedTurns({
    blockingTurn: null,
    lingeringTurns: [],
  });

  const snapshot = tracker.getSnapshot();
  assert.equal(snapshot.activeTurn, null);
  assert.deepEqual(snapshot.activeTurns, []);
  assert.deepEqual(snapshot.lingeringTurns, []);
});
