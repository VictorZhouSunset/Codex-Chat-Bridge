import path from "node:path";

export function shouldSendAttachReadyMessage({ existingBinding, targetThreadId, wasHealthy }) {
  if (!existingBinding) {
    return true;
  }

  if (existingBinding.threadId !== targetThreadId) {
    return true;
  }

  return !wasHealthy;
}

export function buildAttachReadyMessage({ threadId, threadLabel, cwd, accessSummary, notice }) {
  const projectName = summarizeProjectName(cwd);
  const currentThread = summarizeThreadLabel(threadLabel);
  const threadIdLine = threadId ? `threadId: ${threadId}` : null;
  const accessLine = accessSummary ? `权限: ${accessSummary}` : null;
  const noticeLine = notice ? `${notice}` : null;

  return ["Telegram 已可用", `项目: ${projectName}`, `当前线程: ${currentThread}`, threadIdLine, accessLine, noticeLine]
    .filter(Boolean)
    .join("\n");
}

function summarizeProjectName(cwd) {
  if (!cwd) {
    return "未知项目";
  }

  const normalized = path.normalize(cwd);
  const baseName = path.basename(normalized);
  return baseName || normalized;
}

function summarizeThreadLabel(threadLabel) {
  return `${threadLabel ?? ""}`.trim() || "当前 thread";
}
