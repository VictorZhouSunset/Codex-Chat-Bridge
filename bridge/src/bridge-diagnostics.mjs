// input: bridge binding metadata, runtime status, workspace git output, and last relay error records
// output: Telegram-friendly diagnostics replies for help, status, runtime duration, changes, and last-error commands
// pos: formatting and inspection helper for bridge-local operational commands
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

import { describeAccessSummary } from "./access-profile.mjs";

const execFile = promisify(execFileCallback);
const DEFAULT_CHANGE_LIMIT = 10;

export function buildHelpMessage() {
  return [
    "Telegram Bridge 命令:",
    "/status - 查看当前绑定、运行状态和权限",
    "/changes - 查看当前项目的工作区变更",
    "/last-error - 查看最近一次 bridge 错误",
    "/permission - 查看并切换 Telegram relay 权限",
    "/cancel - 取消当前等待中的审批或提问",
    "/interrupt - 中断当前运行中的 turn，并清掉排队消息",
    "/detach - 断开当前 Telegram thread 绑定",
    "",
    "也可以直接发送普通文本继续当前 Codex thread。",
  ].join("\n");
}

export function buildStatusMessage({
  binding,
  runtimeStatus,
  lastError,
  activeRelay = null,
  lingeringTurns = [],
  observedExternalTurn = null,
}) {
  if (!binding) {
    return [
      "Bridge 状态: 未绑定",
      `运行模式: ${runtimeStatus.mode ?? "offline"}`,
      `排队消息: ${runtimeStatus.queueDepth ?? 0}`,
      `待处理交互: ${runtimeStatus.pendingInteractiveCount ?? 0}`,
      formatActiveRelayMessageLine(activeRelay),
      formatActiveRelayLine(activeRelay),
      formatLingeringTurnsWarning(lingeringTurns),
      lastError ? `最近错误: ${lastError.message}` : "最近错误: 无",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const projectName = binding.cwd ? path.basename(binding.cwd) : "Unknown";
  const threadLabel = binding.threadLabel ?? "Unknown";
  const threadId = binding.threadId ?? "Unknown";
  return [
    `Bridge 状态: ${runtimeStatus.mode ?? "offline"}`,
    `项目: ${projectName}`,
    `当前线程: ${threadLabel}`,
    `threadId: ${threadId}`,
    formatExecutionSessionLine(runtimeStatus.attachedSession, runtimeStatus.mode),
    `当前权限: ${describeAccessSummary(binding.access)}`,
    `排队消息: ${runtimeStatus.queueDepth ?? 0}`,
    `待处理交互: ${runtimeStatus.pendingInteractiveCount ?? 0}`,
    formatActiveRelayMessageLine(activeRelay),
    formatActiveRelayLine(activeRelay),
    formatLingeringTurnsWarning(lingeringTurns),
    formatObservedExternalTurnLine(observedExternalTurn),
    lastError ? `最近错误: ${lastError.message}` : "最近错误: 无",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildChangesMessage({ cwd, changes }) {
  const projectName = cwd ? path.basename(cwd) : "Unknown";
  if (!Array.isArray(changes) || changes.length === 0) {
    return `工作区变更 (${projectName}):\n当前没有未提交的文件变化。`;
  }

  const visibleChanges = changes.slice(0, DEFAULT_CHANGE_LIMIT);
  const remainingCount = Math.max(0, changes.length - visibleChanges.length);
  const lines = [`工作区变更 (${projectName}):`, ...visibleChanges];
  if (remainingCount > 0) {
    lines.push(`以及其他 ${remainingCount} 个文件`);
  }
  return lines.join("\n");
}

export function buildLastErrorMessage(lastError) {
  if (!lastError) {
    return "最近没有记录到 bridge 错误。";
  }

  return [
    "最近错误:",
    lastError.message,
    lastError.scope ? `来源: ${lastError.scope}` : null,
    lastError.at ? `时间: ${lastError.at}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function readWorkspaceChanges(cwd) {
  if (!cwd) {
    return [];
  }

  const { stdout } = await execFile("git", ["-C", cwd, "status", "--short"], {
    windowsHide: true,
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatActiveRelayLine(activeRelay) {
  if (!activeRelay) {
    return null;
  }

  if (typeof activeRelay.runningForMs === "number") {
    return `当前运行时长: ${formatDurationMs(activeRelay.runningForMs)}`;
  }

  if (activeRelay.inProgress) {
    return "当前运行时长: 未知（已有 in-progress turn）";
  }

  return null;
}

function formatActiveRelayMessageLine(activeRelay) {
  const preview = `${activeRelay?.textPreview ?? ""}`.trim();
  if (!preview) {
    return null;
  }
  return `当前运行消息: ${summarizePreview(preview)}`;
}

function formatLingeringTurnsWarning(lingeringTurns) {
  const count = Array.isArray(lingeringTurns) ? lingeringTurns.length : 0;
  if (count <= 0) {
    return null;
  }
  return `警告: 当前线程中有 ${count} 个 lingering turns 标记为 "inProgress"，可能是 zombie turns。bridge 已忽略它们。`;
}

function formatObservedExternalTurnLine(observedExternalTurn) {
  if (!observedExternalTurn?.turnId) {
    return null;
  }

  return `观察到外部 in-progress turn: ${observedExternalTurn.turnId}`;
}

function formatExecutionSessionLine(attachedSession, mode) {
  if (mode === "degraded") {
    return "执行会话: degraded";
  }
  if (!attachedSession) {
    return null;
  }
  return attachedSession.sessionReady ? "执行会话: ready" : "执行会话: degraded";
}

function formatDurationMs(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function summarizePreview(text) {
  return text.length > 10 ? `${text.slice(0, 10).trimEnd()} ...` : text;
}
