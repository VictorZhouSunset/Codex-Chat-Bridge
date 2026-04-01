export function summarizeThreadItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  if (item.type === "commandExecution") {
    const command = collapseWhitespace(item.command ?? item.commandLine ?? item.title);
    return command ? `运行命令: ${command}` : "运行命令";
  }

  if (item.type === "mcpToolCall") {
    const toolName = [item.server, item.tool].filter(Boolean).join(".");
    return toolName ? `调用工具: ${toolName}` : "调用工具";
  }

  if (item.type === "fileChange") {
    return "修改文件";
  }

  if (item.type === "agentMessage") {
    return "生成回复";
  }

  const fallback =
    collapseWhitespace(item.title) ??
    collapseWhitespace(item.label) ??
    collapseWhitespace(item.description);
  return fallback;
}

export function formatProgressText(activeSummaries) {
  const summaries = activeSummaries.filter(Boolean);
  const primary = summaries[0] ?? "处理请求";
  const extraCount = Math.max(0, summaries.length - 1);
  const extraSuffix = extraCount > 0 ? `，以及其他 ${extraCount} 个动作` : "";
  return `正在${primary}${extraSuffix}\n（持续工作中）`;
}

function collapseWhitespace(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}
