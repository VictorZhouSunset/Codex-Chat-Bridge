// input: app-server client tests that need deterministic fake JSON-RPC process behavior
// output: reusable fake Codex app-server processes for lifecycle, progress, access, and interactive cases
// pos: shared test helper module for concern-based codex-app-server suites
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import readline from "node:readline";

function createBaseFakeProcess() {
  const fake = new EventEmitter();
  fake.stdin = new PassThrough();
  fake.stdout = new PassThrough();
  fake.stderr = new PassThrough();
  fake.kill = () => {
    fake.emit("exit", 0);
  };
  return fake;
}

function createFakeThread(threadId) {
  return {
    id: threadId,
    preview: "Fake thread",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 0,
    updatedAt: 0,
    status: "idle",
    path: null,
    cwd: "D:\\fake",
    cliVersion: "test",
    source: "codex-app-server",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "Fake",
    turns: [],
  };
}

function handleInitialize(fake, message) {
  fake.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { protocolVersion: 2, capabilities: {} },
    })}\n`,
  );
}

export function createFakeCodexProcess() {
  const fake = createBaseFakeProcess();
  const rl = readline.createInterface({ input: fake.stdin });
  rl.on("line", (line) => {
    const message = JSON.parse(line);

    if (message.method === "initialize") {
      handleInitialize(fake, message);
      return;
    }

    if (message.method === "thread/read") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { thread: createFakeThread(message.params.threadId) },
        })}\n`,
      );
      return;
    }

    if (message.method === "thread/resume") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { thread: createFakeThread(message.params.threadId) },
        })}\n`,
      );
      return;
    }

    if (message.method === "turn/start") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            turn: {
              id: "turn-1",
              status: "in_progress",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "item/agentMessage/delta",
          params: {
            threadId: message.params.threadId,
            turnId: "turn-1",
            itemId: "item-1",
            delta: "Hello",
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "item/agentMessage/delta",
          params: {
            threadId: message.params.threadId,
            turnId: "turn-1",
            itemId: "item-1",
            delta: " world",
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: {
            threadId: message.params.threadId,
            turn: {
              id: "turn-1",
              status: "completed",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );
    }
  });

  return fake;
}

export function createResumeRequiredFakeCodexProcess() {
  const fake = createBaseFakeProcess();
  const resumedThreads = new Set();
  const seenMethods = [];
  const rl = readline.createInterface({ input: fake.stdin });
  rl.on("line", (line) => {
    const message = JSON.parse(line);
    seenMethods.push(message.method);

    if (message.method === "initialize") {
      handleInitialize(fake, message);
      return;
    }

    if (message.method === "thread/resume") {
      resumedThreads.add(message.params.threadId);
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { thread: createFakeThread(message.params.threadId) },
        })}\n`,
      );
      return;
    }

    if (message.method === "turn/start") {
      if (!resumedThreads.has(message.params.threadId)) {
        fake.stdout.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32000,
              message: `thread not found: ${message.params.threadId}`,
            },
          })}\n`,
        );
        return;
      }

      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            turn: {
              id: "turn-2",
              status: "in_progress",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "item/agentMessage/delta",
          params: {
            threadId: message.params.threadId,
            turnId: "turn-2",
            itemId: "item-2",
            delta: "Resumed ok",
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: {
            threadId: message.params.threadId,
            turn: {
              id: "turn-2",
              status: "completed",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );
    }
  });

  fake.getSeenMethods = () => seenMethods;
  return fake;
}

export function createResumeRequiredInterruptFakeCodexProcess() {
  const fake = createBaseFakeProcess();
  const resumedThreads = new Set();
  const seenMethods = [];
  const rl = readline.createInterface({ input: fake.stdin });
  rl.on("line", (line) => {
    const message = JSON.parse(line);
    seenMethods.push(message.method);

    if (message.method === "initialize") {
      handleInitialize(fake, message);
      return;
    }

    if (message.method === "thread/resume") {
      resumedThreads.add(message.params.threadId);
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { thread: createFakeThread(message.params.threadId) },
        })}\n`,
      );
      return;
    }

    if (message.method === "thread/read") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            thread: {
              ...createFakeThread(message.params.threadId),
              turns: [
                {
                  id: "turn-interrupt",
                  status: "inProgress",
                  items: [],
                  input: [],
                },
              ],
            },
          },
        })}\n`,
      );
      return;
    }

    if (message.method === "turn/start") {
      if (!resumedThreads.has(message.params.threadId)) {
        fake.stdout.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32000,
              message: `thread not found: ${message.params.threadId}`,
            },
          })}\n`,
        );
        return;
      }

      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            turn: {
              id: "turn-started",
              status: "in_progress",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: {
            threadId: message.params.threadId,
            turn: {
              id: "turn-started",
              status: "completed",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );
      return;
    }

    if (message.method === "turn/interrupt") {
      if (!resumedThreads.has(message.params.threadId)) {
        fake.stdout.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32000,
              message: `thread not found: ${message.params.threadId}`,
            },
          })}\n`,
        );
        return;
      }

      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            threadId: message.params.threadId,
            turnId: message.params.turnId,
            interrupted: true,
          },
        })}\n`,
      );
    }
  });

  fake.getSeenMethods = () => seenMethods;
  return fake;
}

export function createInterruptHangingFakeCodexProcess() {
  const fake = createBaseFakeProcess();
  const rl = readline.createInterface({ input: fake.stdin });
  rl.on("line", (line) => {
    const message = JSON.parse(line);

    if (message.method === "initialize") {
      handleInitialize(fake, message);
      return;
    }

    if (message.method === "thread/resume") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { thread: createFakeThread(message.params.threadId) },
        })}\n`,
      );
      return;
    }

    if (message.method === "thread/read") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            thread: {
              ...createFakeThread(message.params.threadId),
              turns: [
                {
                  id: "turn-stuck",
                  status: "inProgress",
                  items: [
                    {
                      id: "item-user",
                      type: "userMessage",
                      text: "Unable to activate workspace 还是这么显示",
                    },
                  ],
                  input: [],
                },
              ],
            },
          },
        })}\n`,
      );
      return;
    }

    if (message.method === "turn/interrupt") {
      return;
    }
  });

  return fake;
}

export function createMultipleActiveTurnsFakeCodexProcess() {
  const fake = createBaseFakeProcess();
  const interruptedTurnIds = [];
  const rl = readline.createInterface({ input: fake.stdin });
  rl.on("line", (line) => {
    const message = JSON.parse(line);

    if (message.method === "initialize") {
      handleInitialize(fake, message);
      return;
    }

    if (message.method === "thread/resume") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { thread: createFakeThread(message.params.threadId) },
        })}\n`,
      );
      return;
    }

    if (message.method === "thread/read") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            thread: {
              ...createFakeThread(message.params.threadId),
              turns: [
                {
                  id: "turn-old",
                  status: "inProgress",
                  items: [
                    {
                      id: "item-user-old",
                      type: "userMessage",
                      text: "Unable to activate workspace 还是这么显示",
                    },
                  ],
                  input: [],
                },
                {
                  id: "turn-new",
                  status: "inProgress",
                  items: [
                    {
                      id: "item-user-new",
                      type: "userMessage",
                      text: "Connect me to tg please",
                    },
                  ],
                  input: [],
                },
              ].filter((turn) => !interruptedTurnIds.includes(turn.id)),
            },
          },
        })}\n`,
      );
      return;
    }

    if (message.method === "turn/interrupt") {
      interruptedTurnIds.push(message.params.turnId);
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { interrupted: true },
        })}\n`,
      );
    }
  });

  fake.getInterruptedTurnIds = () => [...interruptedTurnIds];
  return fake;
}

export function createAccessConfigFakeCodexProcess() {
  const fake = createBaseFakeProcess();
  let capturedResumeParams = null;
  let capturedTurnStartParams = null;
  const rl = readline.createInterface({ input: fake.stdin });
  rl.on("line", (line) => {
    const message = JSON.parse(line);

    if (message.method === "initialize") {
      handleInitialize(fake, message);
      return;
    }

    if (message.method === "thread/resume") {
      capturedResumeParams = message.params;
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            approvalPolicy: "never",
            cwd: "D:\\fake",
            model: "gpt-test",
            modelProvider: "openai",
            sandbox: { type: "dangerFullAccess" },
            thread: createFakeThread(message.params.threadId),
          },
        })}\n`,
      );
      return;
    }

    if (message.method === "turn/start") {
      capturedTurnStartParams = message.params;
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            turn: {
              id: "turn-access",
              status: "in_progress",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: {
            threadId: message.params.threadId,
            turn: {
              id: "turn-access",
              status: "completed",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );
    }
  });

  fake.getCapturedResumeParams = () => capturedResumeParams;
  fake.getCapturedTurnStartParams = () => capturedTurnStartParams;
  return fake;
}

export function createProgressFakeCodexProcess() {
  const fake = createBaseFakeProcess();
  const rl = readline.createInterface({ input: fake.stdin });
  rl.on("line", (line) => {
    const message = JSON.parse(line);

    if (message.method === "initialize") {
      handleInitialize(fake, message);
      return;
    }

    if (message.method === "thread/resume") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { thread: createFakeThread(message.params.threadId) },
        })}\n`,
      );
      return;
    }

    if (message.method === "turn/start") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            turn: {
              id: "turn-progress",
              status: "in_progress",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "item/started",
          params: {
            threadId: message.params.threadId,
            turnId: "turn-progress",
            itemId: "item-command",
            item: {
              type: "commandExecution",
              command: "pnpm test",
            },
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "item/started",
          params: {
            threadId: message.params.threadId,
            turnId: "turn-progress",
            itemId: "item-tool",
            item: {
              type: "mcpToolCall",
              server: "playwright",
              tool: "browser_click",
            },
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "item/completed",
          params: {
            threadId: message.params.threadId,
            turnId: "turn-progress",
            itemId: "item-command",
            item: {
              type: "commandExecution",
              command: "pnpm test",
            },
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "item/agentMessage/delta",
          params: {
            threadId: message.params.threadId,
            turnId: "turn-progress",
            itemId: "item-msg",
            delta: "Done",
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: {
            threadId: message.params.threadId,
            turn: {
              id: "turn-progress",
              status: "completed",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );
    }
  });

  return fake;
}

export function createApprovalRequestFakeCodexProcess() {
  const fake = createBaseFakeProcess();
  let capturedApprovalResult = null;
  const rl = readline.createInterface({ input: fake.stdin });
  rl.on("line", (line) => {
    const message = JSON.parse(line);

    if (message.method === "initialize") {
      handleInitialize(fake, message);
      return;
    }

    if (message.method === "thread/resume") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { thread: createFakeThread(message.params.threadId) },
        })}\n`,
      );
      return;
    }

    if (message.method === "turn/start") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            turn: {
              id: "turn-approval",
              status: "in_progress",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );

      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "request-approval-1",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: message.params.threadId,
            turnId: "turn-approval",
            itemId: "item-approval",
            command: "pnpm test",
            cwd: "D:\\fake",
            reason: "Need approval to run tests.",
            availableDecisions: ["accept", "decline", "cancel"],
          },
        })}\n`,
      );
      return;
    }

    if (message.id === "request-approval-1" && typeof message.method === "undefined") {
      capturedApprovalResult = message.result;
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "serverRequest/resolved",
          params: {
            threadId: "thread-approval",
            requestId: "request-approval-1",
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-approval",
            turnId: "turn-approval",
            itemId: "item-msg",
            delta: "Approved and continued",
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: {
            threadId: "thread-approval",
            turn: {
              id: "turn-approval",
              status: "completed",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );
    }
  });

  fake.getCapturedApprovalResult = () => capturedApprovalResult;
  return fake;
}

export function createUserInputRequestFakeCodexProcess() {
  const fake = createBaseFakeProcess();
  let capturedUserInputResult = null;
  const rl = readline.createInterface({ input: fake.stdin });
  rl.on("line", (line) => {
    const message = JSON.parse(line);

    if (message.method === "initialize") {
      handleInitialize(fake, message);
      return;
    }

    if (message.method === "thread/resume") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { thread: createFakeThread(message.params.threadId) },
        })}\n`,
      );
      return;
    }

    if (message.method === "turn/start") {
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            turn: {
              id: "turn-user-input",
              status: "in_progress",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );

      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "request-input-1",
          method: "item/tool/requestUserInput",
          params: {
            threadId: message.params.threadId,
            turnId: "turn-user-input",
            itemId: "item-user-input",
            questions: [
              {
                id: "tone",
                header: "Tone",
                question: "Pick a tone",
                isOther: true,
                isSecret: false,
                options: [
                  { label: "Short", description: "Keep it concise" },
                  { label: "Friendly", description: "Make it warm" },
                ],
              },
              {
                id: "note",
                header: "Note",
                question: "Add a short note",
                isOther: true,
                isSecret: false,
                options: null,
              },
            ],
          },
        })}\n`,
      );
      return;
    }

    if (message.id === "request-input-1" && typeof message.method === "undefined") {
      capturedUserInputResult = message.result;
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "serverRequest/resolved",
          params: {
            threadId: "thread-user-input",
            requestId: "request-input-1",
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-user-input",
            turnId: "turn-user-input",
            itemId: "item-msg",
            delta: "Collected input",
          },
        })}\n`,
      );
      fake.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: {
            threadId: "thread-user-input",
            turn: {
              id: "turn-user-input",
              status: "completed",
              items: [],
              input: [],
            },
          },
        })}\n`,
      );
    }
  });

  fake.getCapturedUserInputResult = () => capturedUserInputResult;
  return fake;
}
