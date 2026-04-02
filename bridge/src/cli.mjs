// input: CLI argv, local bridge config/state files, Codex thread context, and bridge daemon status
// output: command-line side effects for attach/detach/status/serve and printed operator feedback
// pos: process entrypoint for the install-first Node bridge package
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

import { describeAccessSummary } from "./access-profile.mjs";
import { ensureStateFile, getBinding, readState, writeState } from "./binding-store.mjs";
import { buildAttachReadyMessage, shouldSendAttachReadyMessage } from "./attach-notification.mjs";
import { BridgeService } from "./bridge-service.mjs";
import { createControlServer, shouldKeepServing } from "./control-server.mjs";
import { CodexAppServerClient } from "./codex-app-server.mjs";
import {
  attachBridgeBinding,
  detachBridgeBinding,
  ensureBridgeRunning,
  fetchBridgeStatus,
  isBridgeHealthy,
  stopBridge,
} from "./daemon-control.mjs";
import { observeRelayCompletion } from "./relay-result.mjs";
import { fetchAndProcessTelegramUpdates } from "./serve-loop.mjs";
import { TelegramApi } from "./telegram-api.mjs";
import { createTrayCompanionLauncher } from "./tray-companion.mjs";
import {
  buildUsageText,
  getControlPort,
  isAllowedChat,
  parseArgs,
  resolveExplicitAttachAccessArgs,
  resolveAttachInputs,
} from "./cli-support.mjs";
import { resolveAttachAccessContext } from "./desktop-access-context.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bridgeRoot = path.resolve(__dirname, "..");
const configPath = path.join(bridgeRoot, "config.json");
const exampleConfigPath = path.join(bridgeRoot, "config.example.json");
const statePath = path.join(bridgeRoot, "state.json");

const [command, ...restArgs] = process.argv.slice(2);

const commands = {
  "init-config": initConfigCommand,
  "start-service": startServiceCommand,
  "stop-service": stopServiceCommand,
  attach: attachCommand,
  detach: detachCommand,
  status: statusCommand,
  inject: injectCommand,
  serve: serveCommand,
};

if (!commands[command]) {
  printUsage();
  process.exitCode = 1;
} else {
  commands[command](parseArgs(restArgs)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

async function initConfigCommand() {
  try {
    await readFile(configPath, "utf8");
    console.log(`Config already exists at ${configPath}`);
    return;
  } catch {}

  const example = await readFile(exampleConfigPath, "utf8");
  await writeFile(configPath, example, "utf8");
  console.log(`Created ${configPath}. Fill in your Telegram bot token and chat ids before serving.`);
}

async function attachCommand(args) {
  const config = await loadConfig();
  const controlPort = getControlPort(config);
  const { chatId, threadId } = resolveAttachInputs({
    args,
    config,
    env: process.env,
  });
  const explicitAccess = resolveExplicitAttachAccessArgs(args);
  const wasHealthy = await isBridgeHealthy({ controlPort });
  const existingBinding = chatId ? await getBinding(statePath, chatId) : null;

  await ensureBridgeRunning({
    controlPort,
    startFn: async () => {
      startDetachedBridge();
    },
  });

  const codexClient = new CodexAppServerClient();
  await codexClient.start();
  let thread;
  try {
    thread = await codexClient.readThread(threadId);
  } finally {
    await codexClient.close();
  }

  const accessContext = resolveAttachAccessContext({
    explicitAccess,
    cwd: args.cwd ?? thread.cwd ?? process.cwd(),
  });

  let binding;
  try {
    binding = await attachBridgeBinding({
      controlPort,
      binding: {
        chatId,
        threadId,
        threadLabel: args["thread-label"] ?? thread.name ?? thread.preview,
        cwd: args.cwd ?? thread.cwd ?? process.cwd(),
        access: accessContext.access,
      },
    });
  } catch (error) {
    if (error?.code === "BINDING_CONFLICT") {
      const existingBinding = error.binding;
      const existingLabel = existingBinding?.threadLabel ? ` (${existingBinding.threadLabel})` : "";
      throw new Error(
        `Telegram is already attached to thread ${existingBinding?.threadId ?? "unknown"}${existingLabel}. Run detach first, then attach the new thread.`,
      );
    }
    throw error;
  }

  if (
    shouldSendAttachReadyMessage({
      existingBinding,
      targetThreadId: binding.threadId,
      wasHealthy,
    })
  ) {
    const telegramApi = new TelegramApi({ token: config.telegramBotToken });
    await telegramApi.sendMessage(
      binding.chatId,
      buildAttachReadyMessage({
        threadId: binding.threadId,
        threadLabel: binding.threadLabel,
        cwd: binding.cwd,
        accessSummary: describeAccessSummary(binding.access),
        notice: accessContext.notice,
      }),
    );
  }

  console.log(JSON.stringify(binding, null, 2));
}

async function detachCommand(args) {
  const config = await loadConfig({ optional: true });
  const chatId = `${args["chat-id"] ?? config?.defaultChatId ?? ""}`.trim();
  if (!chatId) {
    throw new Error("detach requires --chat-id or config.defaultChatId.");
  }

  const controlPort = config ? getControlPort(config) : null;
  if (controlPort && (await isBridgeHealthy({ controlPort }))) {
    await detachBridgeBinding({ controlPort, chatId });
  } else {
    const service = new BridgeService({
      statePath,
      codexClient: null,
      telegramApi: null,
    });
    await service.detach(chatId);
  }
  console.log(`Detached Telegram chat ${chatId}.`);
}

async function statusCommand(args) {
  const config = await loadConfig({ optional: true });
  const chatId = `${args["chat-id"] ?? config?.defaultChatId ?? ""}`.trim();
  if (!chatId) {
    throw new Error("status requires --chat-id or config.defaultChatId.");
  }

  const controlPort = config ? getControlPort(config) : null;
  const serviceHealthy = config ? await isBridgeHealthy({ controlPort }) : false;
  if (serviceHealthy) {
    try {
      const liveStatus = await fetchBridgeStatus({ controlPort });
      console.log(
        JSON.stringify(
          {
            ...liveStatus,
            serviceHealthy: true,
          },
          null,
          2,
        ),
      );
      return;
    } catch {}
  }

  const service = new BridgeService({
    statePath,
    codexClient: null,
    telegramApi: null,
  });
  const status = await service.getStatus(chatId);
  console.log(
    JSON.stringify(
      {
        ...status,
        serviceHealthy,
      },
      null,
      2,
    ),
  );
}

async function injectCommand(args) {
  const chatId = `${args["chat-id"] ?? ""}`.trim();
  const text = `${args.text ?? ""}`;
  if (!chatId || !text) {
    throw new Error("inject requires --chat-id and --text.");
  }

  const service = new BridgeService({
    statePath,
    codexClient: {
      async relayText(payload) {
        return {
          threadId: payload.threadId,
          turnId: "inject-turn",
          text: `inject:${payload.text}`,
        };
      },
    },
    telegramApi: {
      async sendMessage(targetChatId, messageText) {
        console.log(JSON.stringify({ chatId: targetChatId, text: messageText }, null, 2));
      },
    },
  });

  await service.handleTelegramMessage({ chatId, text });
}

async function serveCommand() {
  const config = await loadConfig();
  await ensureStateFile(statePath);
  const controlPort = getControlPort(config);
  const trayCompanionLauncher = createTrayCompanionLauncher({
    bridgeRoot,
    controlPort,
  });
  await trayCompanionLauncher.ensureStarted();
  const telegramApi = new TelegramApi({ token: config.telegramBotToken });
  try {
    await telegramApi.setMyCommands([
      { command: "status", description: "Show bridge status for the current chat" },
      { command: "cancel", description: "Cancel the pending approval or question" },
      { command: "interrupt", description: "Interrupt the active turn and clear queued messages" },
      { command: "detach", description: "Detach Telegram from the current Codex thread" },
      { command: "permission", description: "Show or change bridge permission profile" },
    ]);
  } catch {}
  const codexClient = new CodexAppServerClient();
  await codexClient.start();

  const service = new BridgeService({
    statePath,
    codexClient,
    telegramApi,
  });

  const controlServer = createControlServer({
    bridgeService: service,
  });

  await new Promise((resolve, reject) => {
    controlServer.once("error", reject);
    controlServer.listen(controlPort, "127.0.0.1", () => {
      controlServer.off("error", reject);
      resolve();
    });
  });

  console.log(`Telegram Codex bridge is polling for updates on control port ${controlPort}.`);

  try {
    while (true) {
      const runtime = await service.getRuntimeStatus();
      if (!shouldKeepServing(runtime)) {
        break;
      }

      await trayCompanionLauncher.ensureStarted();

      await fetchAndProcessTelegramUpdates({
        statePath,
        config,
        telegramApi,
        service,
        readStateFn: readState,
        writeStateFn: writeState,
        observeRelayCompletionFn: observeRelayCompletion,
        onError: (error) => {
          console.error(`Telegram relay loop error: ${error.message ?? String(error)}`);
        },
        isAllowedChat,
      });
    }
  } finally {
    await new Promise((resolve) => {
      controlServer.close(() => resolve());
    });
    await codexClient.close();
  }
}

async function startServiceCommand() {
  const config = await loadConfig();
  await ensureBridgeRunning({
    controlPort: getControlPort(config),
    startFn: async () => {
      startDetachedBridge();
    },
  });
  console.log(`Telegram bridge is running on control port ${getControlPort(config)}.`);
}

async function stopServiceCommand() {
  const config = await loadConfig();
  await stopBridge({ controlPort: getControlPort(config), source: "cli" });
  console.log(`Telegram bridge stop signal sent to port ${getControlPort(config)}.`);
}

async function loadConfig({ optional = false } = {}) {
  try {
    const content = await readFile(configPath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (optional) {
      return null;
    }
    throw new Error(`Missing ${configPath}. Run init-config first.`);
  }
}

function startDetachedBridge() {
  const child = spawn(process.execPath, [path.join(bridgeRoot, "src", "cli.mjs"), "serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function printUsage() {
  console.log(buildUsageText());
}
