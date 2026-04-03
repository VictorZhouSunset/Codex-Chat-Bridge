// input: bridge runtime dependencies, persisted bindings, and Telegram command invocations
// output: normalized command responses plus Telegram-facing status, permission, and diagnostics side effects
// pos: internal command helper layer for bridge-service Telegram command handling
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import {
  applyPermissionLevel,
  describeAccessSummary,
} from "../access-profile.mjs";
import {
  buildChangesMessage,
  buildLastErrorMessage,
  buildStatusMessage,
} from "../bridge-diagnostics.mjs";
import {
  getBinding,
  getLastRelayRecord,
  updateBinding,
} from "../binding-store.mjs";

export async function handlePermissionCommand(context, chatId, permissionLevel) {
  const binding = await getBinding(context.statePath, chatId);
  if (!binding) {
    await context.telegramApi.sendMessage(
      chatId,
      "No Codex thread is attached to this Telegram chat yet.",
    );
    return { kind: "missing-binding" };
  }

  if (!permissionLevel) {
    await context.telegramApi.sendMessage(
      chatId,
      `当前权限: ${describeAccessSummary(binding.access)}`,
      {
        reply_markup: buildPermissionChooser(),
      },
    );
    return { kind: "permission" };
  }

  const updatedBinding = await updateBinding(context.statePath, chatId, (existingBinding) => ({
    ...existingBinding,
    access: applyPermissionLevel({
      level: permissionLevel,
      accessState: existingBinding.access,
      cwd: existingBinding.cwd,
    }),
  }));

  await context.telegramApi.sendMessage(
    chatId,
    `权限已切换到 ${permissionLevel}。\n当前权限: ${describeAccessSummary(updatedBinding.access)}`,
  );
  return { kind: "permission" };
}

export async function handleStatusCommand(context, chatId) {
  const binding = await getBinding(context.statePath, chatId);
  const runtimeStatus = await context.getRuntimeStatus({ refreshAttachedTurns: true });
  const lastError = await getLastRelayRecord(context.statePath, chatId);
  let activeRelay =
    runtimeStatus.activeRelays?.find((relay) => relay.chatId === chatId) ??
    context.formatAttachedSessionTurn(runtimeStatus.attachedSession?.activeTurn) ??
    null;
  let lingeringTurns = context.formatAttachedSessionTurns(
    runtimeStatus.attachedSession?.lingeringTurns ?? [],
  );
  let observedExternalTurn = null;

  if (binding && !activeRelay && lingeringTurns.length === 0) {
    const refreshedActivity = await context.inspectAttachedThreadActivity(binding, chatId);
    activeRelay =
      context.formatAttachedSessionTurn(
        refreshedActivity.blockingTurn
          ? {
              ...refreshedActivity.blockingTurn,
              chatId,
              threadId: binding.threadId,
              source: "attached-thread",
              inProgress: true,
            }
          : null,
      ) ?? activeRelay;
    lingeringTurns = context.formatAttachedSessionTurns(
      (refreshedActivity.lingeringTurns ?? []).map((turn) => ({
        ...turn,
        chatId,
        threadId: binding.threadId,
        source: "attached-thread",
        inProgress: true,
      })),
    );
  }

  if (
    !activeRelay &&
    binding &&
    runtimeStatus.mode === "degraded" &&
    (context.codexClient?.inspectThreadActivity || context.codexClient?.inspectActiveTurns)
  ) {
    const threadActivity = await context.readThreadActivity(binding.threadId);
    if (threadActivity.blockingTurn) {
      const latestTurn = threadActivity.blockingTurn;
      observedExternalTurn = {
        turnId: latestTurn?.id ?? null,
        threadId: binding.threadId,
      };
    }
  }

  await context.telegramApi.sendMessage(
    chatId,
    buildStatusMessage({
      binding,
      runtimeStatus,
      lastError,
      activeRelay,
      lingeringTurns,
      observedExternalTurn,
    }),
  );
  return { kind: "status" };
}

export async function handleChangesCommand(context, chatId) {
  const binding = await getBinding(context.statePath, chatId);
  if (!binding) {
    await context.telegramApi.sendMessage(
      chatId,
      "No Codex thread is attached to this Telegram chat yet.",
    );
    return { kind: "missing-binding" };
  }

  try {
    const changes = await context.readWorkspaceChanges(binding.cwd ?? null);
    await context.telegramApi.sendMessage(
      chatId,
      buildChangesMessage({ cwd: binding.cwd, changes }),
    );
    return { kind: "changes" };
  } catch (error) {
    await context.recordLastError(chatId, {
      scope: "changes",
      message: error.message ?? String(error),
    });
    await context.telegramApi.sendMessage(
      chatId,
      `无法读取工作区变更: ${error.message ?? String(error)}`,
    );
    return { kind: "changes" };
  }
}

export async function handleLastErrorCommand(context, chatId) {
  const lastError = await getLastRelayRecord(context.statePath, chatId);
  await context.telegramApi.sendMessage(chatId, buildLastErrorMessage(lastError));
  return { kind: "last-error" };
}

export function buildPermissionChooser() {
  return {
    inline_keyboard: [
      [
        {
          text: "default",
          callback_data: "permission:default",
        },
        {
          text: "readonly",
          callback_data: "permission:readonly",
        },
      ],
      [
        {
          text: "workspace",
          callback_data: "permission:workspace",
        },
        {
          text: "full",
          callback_data: "permission:full",
        },
      ],
    ],
  };
}
