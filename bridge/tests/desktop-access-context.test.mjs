// input: desktop Codex permission environment variables and optional cwd context
// output: verified attach-time access selection between desktop-derived access and readonly fallback
// pos: unit test for desktop access context resolution during Telegram attach
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { resolveAttachAccessContext } from "../src/desktop-access-context.mjs";

test("falls back to readonly access with a warning when desktop access is unavailable", () => {
  const result = resolveAttachAccessContext({
    env: {},
    cwd: "D:\\project-a",
  });

  assert.deepEqual(result.access, {
    defaultApprovalPolicy: "on-request",
    defaultSandboxPolicy: {
      type: "readOnly",
      access: { type: "fullAccess" },
      networkAccess: false,
    },
    overrideApprovalPolicy: null,
    overrideSandboxPolicy: null,
  });
  assert.match(result.notice, /读取桌面端权限失败/);
  assert.match(result.notice, /readonly/);
});

test("uses desktop Codex access when explicit permission env vars are available", () => {
  const result = resolveAttachAccessContext({
    env: {
      CODEX_APPROVAL_POLICY: "never",
      CODEX_SANDBOX_POLICY: "danger-full-access",
    },
    cwd: "D:\\project-a",
  });

  assert.deepEqual(result.access, {
    defaultApprovalPolicy: "never",
    defaultSandboxPolicy: { type: "dangerFullAccess" },
    overrideApprovalPolicy: null,
    overrideSandboxPolicy: null,
  });
  assert.equal(result.notice, null);
});

test("maps desktop workspace-write sandbox into the bridge access state", () => {
  const result = resolveAttachAccessContext({
    env: {
      CODEX_APPROVAL_POLICY: "on-request",
      CODEX_SANDBOX_POLICY: "workspace-write",
    },
    cwd: "D:\\project-a",
  });

  assert.deepEqual(result.access, {
    defaultApprovalPolicy: "on-request",
    defaultSandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: ["D:\\project-a"],
      readOnlyAccess: { type: "fullAccess" },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
    overrideApprovalPolicy: null,
    overrideSandboxPolicy: null,
  });
  assert.equal(result.notice, null);
});
