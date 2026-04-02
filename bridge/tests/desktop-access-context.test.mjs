// input: desktop Codex permission environment variables and optional cwd context
// output: verified attach-time access selection between desktop-derived access and readonly fallback
// pos: unit test for desktop access context resolution during Telegram attach
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { resolveAttachAccessContext } from "../src/desktop-access-context.mjs";

test("falls back to readonly access with a warning when Codex does not provide explicit access", () => {
  const result = resolveAttachAccessContext({
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
  assert.match(result.notice, /Codex 未写入当前会话权限/);
  assert.match(result.notice, /readonly/);
});

test("uses explicit attach access arguments when Codex provides them", () => {
  const result = resolveAttachAccessContext({
    explicitAccess: {
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
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

test("maps explicit workspace-write sandbox into the bridge access state", () => {
  const result = resolveAttachAccessContext({
    explicitAccess: {
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
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

test("throws when explicit attach access is malformed", () => {
  assert.throws(
    () =>
      resolveAttachAccessContext({
        explicitAccess: {
          approvalPolicy: "bad-policy",
          sandboxMode: "danger-full-access",
        },
        cwd: "D:\\project-a",
      }),
    /Invalid --approval-policy/i,
  );

  assert.throws(
    () =>
      resolveAttachAccessContext({
        explicitAccess: {
          approvalPolicy: "never",
          sandboxMode: "bad-sandbox",
        },
        cwd: "D:\\project-a",
      }),
    /Invalid --sandbox-mode/i,
  );
});
