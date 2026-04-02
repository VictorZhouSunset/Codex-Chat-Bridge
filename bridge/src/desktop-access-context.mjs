// input: explicit attach-time Codex session permission arguments and optional cwd context
// output: attach-time bridge access defaults plus an optional fallback notice for Telegram
// pos: desktop integration helper that keeps Telegram attach access aligned with the local Codex session when possible
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import { createAccessState } from "./access-profile.mjs";

export function resolveAttachAccessContext({
  explicitAccess = null,
  cwd,
} = {}) {
  if (explicitAccess) {
    const approvalPolicy = normalizeApprovalPolicy(explicitAccess.approvalPolicy);
    if (!approvalPolicy) {
      throw new Error(
        "Invalid --approval-policy. Expected one of: never, on-request, on-failure, untrusted.",
      );
    }

    const sandboxPolicy = normalizeSandboxPolicy({
      rawSandboxPolicy: explicitAccess.sandboxMode,
      cwd,
    });
    if (!sandboxPolicy) {
      throw new Error(
        "Invalid --sandbox-mode. Expected one of: read-only, workspace-write, danger-full-access.",
      );
    }

    return {
      access: createAccessState({
        approvalPolicy,
        sandboxPolicy,
      }),
      notice: null,
    };
  }

  return {
    access: createAccessState({
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "readOnly",
        access: { type: "fullAccess" },
        networkAccess: false,
      },
    }),
    notice: "Codex 未写入当前会话权限，采用默认权限 readonly",
  };
}

function normalizeApprovalPolicy(value) {
  if (value === "never" || value === "on-request" || value === "on-failure" || value === "untrusted") {
    return value;
  }
  return null;
}

function normalizeSandboxPolicy({ rawSandboxPolicy, cwd }) {
  if (rawSandboxPolicy === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }

  if (rawSandboxPolicy === "read-only") {
    return {
      type: "readOnly",
      access: { type: "fullAccess" },
      networkAccess: false,
    };
  }

  if (rawSandboxPolicy === "workspace-write") {
    return {
      type: "workspaceWrite",
      writableRoots: cwd ? [cwd] : [],
      readOnlyAccess: { type: "fullAccess" },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    };
  }

  return null;
}
