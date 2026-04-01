// input: desktop Codex permission environment variables and optional cwd context
// output: attach-time bridge access defaults plus an optional fallback notice for Telegram
// pos: desktop integration helper that keeps Telegram attach access aligned with the local Codex session when possible
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import { createAccessState } from "./access-profile.mjs";

export function resolveAttachAccessContext({
  env = process.env,
  cwd,
} = {}) {
  const approvalPolicy = normalizeApprovalPolicy(env.CODEX_APPROVAL_POLICY);
  const sandboxPolicy = normalizeSandboxPolicy({
    rawSandboxPolicy: env.CODEX_SANDBOX_POLICY,
    cwd,
  });

  if (approvalPolicy && sandboxPolicy) {
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
    notice: "读取桌面端权限失败，采用默认权限 readonly",
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
