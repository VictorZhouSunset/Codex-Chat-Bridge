import { readState, writeState } from "./binding-store.mjs";
import { observeRelayCompletion } from "./relay-result.mjs";

const MAX_UPDATE_FAILURE_RETRIES = 3;

export async function fetchTelegramUpdatesSafe({
  telegramApi,
  offset,
  timeoutSeconds,
  onError = () => {},
}) {
  try {
    return await telegramApi.fetchUpdates({
      offset,
      timeoutSeconds,
    });
  } catch (error) {
    onError(error);
    return [];
  }
}

export async function processTelegramUpdateBatch({
  updates,
  state,
  statePath,
  service,
  telegramApi,
  config,
  writeStateFn = writeState,
  observeRelayCompletionFn = observeRelayCompletion,
  onError = () => {},
  isAllowedChat,
}) {
  state.updateFailureCounts ??= {};
  for (const update of updates) {
    const message = normalizeTelegramUpdate(update);
    if (!message) {
      const nextOffset = update.update_id + 1;
      state.telegramOffset = Math.max(state.telegramOffset, nextOffset);
      await writeStateFn(statePath, state);
      continue;
    }

    const chatId = message.chatId;
    if (!isAllowedChat(config, chatId)) {
      const nextOffset = update.update_id + 1;
      state.telegramOffset = Math.max(state.telegramOffset, nextOffset);
      await writeStateFn(statePath, state);
      continue;
    }

    try {
      const relayResult = await service.handleTelegramMessage(message);
      if (message.callbackQueryId) {
        await telegramApi?.answerCallbackQuery?.(message.callbackQueryId);
      }
      observeRelayCompletionFn(relayResult, onError);
      delete state.updateFailureCounts[String(update.update_id)];
      const nextOffset = update.update_id + 1;
      state.telegramOffset = Math.max(state.telegramOffset, nextOffset);
      await writeStateFn(statePath, state);
    } catch (error) {
      onError(error);
      const failureKey = String(update.update_id);
      const failureCount = Number(state.updateFailureCounts[failureKey] ?? 0) + 1;
      state.updateFailureCounts[failureKey] = failureCount;

      if (failureCount >= MAX_UPDATE_FAILURE_RETRIES) {
        delete state.updateFailureCounts[failureKey];
        try {
          if (message.callbackQueryId) {
            await telegramApi?.answerCallbackQuery?.(message.callbackQueryId, {
              text: `上一条命令出现错误，重试${failureCount}次依然失败`,
            });
          } else {
            await telegramApi?.sendMessage?.(
              message.chatId,
              `上一条命令出现错误，重试${failureCount}次依然失败`,
            );
          }
        } catch (notificationError) {
          onError(notificationError);
        }
        const nextOffset = update.update_id + 1;
        state.telegramOffset = Math.max(state.telegramOffset, nextOffset);
        await writeStateFn(statePath, state);
        continue;
      }

      await writeStateFn(statePath, state);
      break;
    }
  }
}

export async function fetchAndProcessTelegramUpdates({
  statePath,
  config,
  telegramApi,
  service,
  readStateFn = readState,
  writeStateFn = writeState,
  observeRelayCompletionFn = observeRelayCompletion,
  onError = () => {},
  isAllowedChat,
}) {
  const state = await readStateFn(statePath);
  const updates = await fetchTelegramUpdatesSafe({
    telegramApi,
    offset: state.telegramOffset,
    timeoutSeconds: Math.max(1, Math.floor((config.pollIntervalMs ?? 5000) / 1000)),
    onError,
  });

  await processTelegramUpdateBatch({
    updates,
    state,
    statePath,
    service,
    telegramApi,
    config,
    writeStateFn,
    observeRelayCompletionFn,
    onError,
    isAllowedChat,
  });
}

function normalizeTelegramUpdate(update) {
  const message = update.message;
  if (message?.chat?.id && typeof message.text === "string") {
    return {
      chatId: String(message.chat.id),
      text: message.text,
    };
  }

  const callbackQuery = update.callback_query;
  if (
    callbackQuery?.message?.chat?.id &&
    typeof callbackQuery.data === "string" &&
    callbackQuery.id
  ) {
    return {
      chatId: String(callbackQuery.message.chat.id),
      text: callbackQuery.data,
      callbackQueryId: callbackQuery.id,
    };
  }

  return null;
}
