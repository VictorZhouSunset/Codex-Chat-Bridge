import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export function createEmptyState() {
  return {
    activeBindings: {},
    telegramOffset: 0,
    lastRelayByChat: {},
    updateFailureCounts: {},
  };
}

export async function ensureStateFile(statePath) {
  try {
    await readState(statePath);
  } catch {
    await writeState(statePath, createEmptyState());
  }
}

export async function attachBinding(statePath, binding) {
  const state = await readState(statePath);
  const existingBinding = state.activeBindings[binding.chatId] ?? null;
  if (existingBinding) {
    if (existingBinding.threadId === binding.threadId) {
      if (!existingBinding.access && binding.access) {
        state.activeBindings[binding.chatId] = {
          ...existingBinding,
          access: binding.access,
        };
        await writeState(statePath, state);
        return state.activeBindings[binding.chatId];
      }

      return existingBinding;
    }

    throw createBindingConflictError(existingBinding);
  }

  state.activeBindings[binding.chatId] = {
    chatId: binding.chatId,
    threadId: binding.threadId,
    threadLabel: binding.threadLabel ?? null,
    cwd: binding.cwd ?? null,
    access: binding.access ?? null,
    attachedAt: new Date().toISOString(),
  };
  await writeState(statePath, state);
  return state.activeBindings[binding.chatId];
}

export async function replaceAllBindingsWith(statePath, binding) {
  const state = await readState(statePath);
  const existingBinding = state.activeBindings[binding.chatId] ?? null;
  const attachedAt =
    existingBinding?.threadId === binding.threadId
      ? existingBinding.attachedAt
      : new Date().toISOString();

  state.activeBindings = {
    [binding.chatId]: {
      chatId: binding.chatId,
      threadId: binding.threadId,
      threadLabel: binding.threadLabel ?? null,
      cwd: binding.cwd ?? null,
      access: binding.access ?? null,
      attachedAt,
    },
  };
  await writeState(statePath, state);
  return state.activeBindings[binding.chatId];
}

export async function detachBinding(statePath, chatId) {
  const state = await readState(statePath);
  delete state.activeBindings[chatId];
  await writeState(statePath, state);
}

export async function clearAllBindings(statePath) {
  const state = await readState(statePath);
  state.activeBindings = {};
  await writeState(statePath, state);
}

export async function getBinding(statePath, chatId) {
  const state = await readState(statePath);
  return state.activeBindings[chatId] ?? null;
}

export async function updateBinding(statePath, chatId, updater) {
  const state = await readState(statePath);
  const existingBinding = state.activeBindings[chatId] ?? null;
  if (!existingBinding) {
    return null;
  }

  state.activeBindings[chatId] = updater(existingBinding);
  await writeState(statePath, state);
  return state.activeBindings[chatId];
}

export async function getLastRelayRecord(statePath, chatId) {
  const state = await readState(statePath);
  return state.lastRelayByChat?.[chatId] ?? null;
}

export async function updateLastRelayRecord(statePath, chatId, updater) {
  const state = await readState(statePath);
  state.lastRelayByChat ??= {};
  state.lastRelayByChat[chatId] = updater(state.lastRelayByChat[chatId] ?? null);
  await writeState(statePath, state);
  return state.lastRelayByChat[chatId];
}

export async function writeTelegramRuntimeState(
  statePath,
  state,
  {
    readStateFn = readState,
    writeStateFn = writeState,
  } = {},
) {
  let currentState;
  try {
    currentState = await readStateFn(statePath);
  } catch {
    currentState = createEmptyState();
  }

  currentState.telegramOffset = state.telegramOffset ?? 0;
  currentState.updateFailureCounts = structuredClone(state.updateFailureCounts ?? {});
  await writeStateFn(statePath, currentState);
  return currentState;
}

export async function readState(statePath) {
  const content = await readFile(statePath, "utf8");
  return JSON.parse(content);
}

export async function writeState(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function createBindingConflictError(existingBinding) {
  const threadLabel = existingBinding.threadLabel ? ` (${existingBinding.threadLabel})` : "";
  const error = new Error(
    `Telegram chat ${existingBinding.chatId} is already attached to thread ${existingBinding.threadId}${threadLabel}. Detach it before attaching a new thread.`,
  );
  error.code = "BINDING_CONFLICT";
  error.binding = existingBinding;
  return error;
}
