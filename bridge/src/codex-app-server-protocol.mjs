// input: raw app-server JSON-RPC messages and sandbox policy objects
// output: normalized interactive request payloads, item ids, and resume-safe sandbox modes
// pos: protocol helper for the Codex app-server adapter
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
export function normalizeServerRequest(message) {
  if (!message?.params) {
    return null;
  }

  if (message.method === "item/commandExecution/requestApproval") {
    return {
      kind: "command_approval",
      requestId: message.id,
      threadId: message.params.threadId,
      turnId: message.params.turnId,
      itemId: message.params.itemId,
      approvalId: message.params.approvalId ?? null,
      reason: message.params.reason ?? null,
      command: message.params.command ?? null,
      cwd: message.params.cwd ?? null,
      availableDecisions: message.params.availableDecisions ?? null,
    };
  }

  if (message.method === "item/fileChange/requestApproval") {
    return {
      kind: "file_change_approval",
      requestId: message.id,
      threadId: message.params.threadId,
      turnId: message.params.turnId,
      itemId: message.params.itemId,
      reason: message.params.reason ?? null,
      grantRoot: message.params.grantRoot ?? null,
    };
  }

  if (message.method === "item/tool/requestUserInput") {
    return {
      kind: "user_input",
      requestId: message.id,
      threadId: message.params.threadId,
      turnId: message.params.turnId,
      itemId: message.params.itemId,
      questions: message.params.questions ?? [],
    };
  }

  return null;
}

export function getItemId(params) {
  return params?.itemId ?? params?.item?.id ?? null;
}

export function toSandboxMode(sandboxPolicy) {
  if (!sandboxPolicy) {
    return sandboxPolicy;
  }

  if (typeof sandboxPolicy === "string") {
    return sandboxPolicy;
  }

  switch (sandboxPolicy.type) {
    case "dangerFullAccess":
      return "danger-full-access";
    case "readOnly":
      return "read-only";
    case "workspaceWrite":
      return "workspace-write";
    default:
      throw new Error(
        `Unsupported sandbox policy type for thread/resume: ${sandboxPolicy.type ?? "unknown"}`,
      );
  }
}
