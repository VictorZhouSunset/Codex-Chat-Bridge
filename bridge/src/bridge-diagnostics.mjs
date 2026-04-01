// input: bridge binding metadata, runtime status, workspace git output, and last relay error records
// output: Telegram-friendly diagnostics replies for help, status, changes, and last-error commands
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
    "/detach - 断开当前 Telegram thread 绑定",
    "",
    "也可以直接发送普通文本继续当前 Codex thread。",
  ].join("\n");
}

export function buildStatusMessage({ binding, runtimeStatus, lastError }) {
  if (!binding) {
    return [
      "Bridge 状态: 未绑定",
      `运行模式: ${runtimeStatus.mode ?? "offline"}`,
      `排队消息: ${runtimeStatus.queueDepth ?? 0}`,
      `待处理交互: ${runtimeStatus.pendingInteractiveCount ?? 0}`,
      lastError ? `最近错误: ${lastError.message}` : "最近错误: 无",
    ].join("\n");
  }

  const projectName = binding.cwd ? path.basename(binding.cwd) : "Unknown";
  const threadLabel = binding.threadLabel ?? "Unknown";
  const threadId = binding.threadId ?? "Unknown";
  return [
    `Bridge 状态: ${runtimeStatus.mode ?? "offline"}`,
    `项目: ${projectName}`,
    `当前线程: ${threadLabel}`,
    `threadId: ${threadId}`,
    `当前权限: ${describeAccessSummary(binding.access)}`,
    `排队消息: ${runtimeStatus.queueDepth ?? 0}`,
    `待处理交互: ${runtimeStatus.pendingInteractiveCount ?? 0}`,
    lastError ? `最近错误: ${lastError.message}` : "最近错误: 无",
  ].join("\n");
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
