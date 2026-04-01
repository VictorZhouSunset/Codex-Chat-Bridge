// input: fake Codex app-server processes that capture thread/resume and turn/start access parameters
// output: verified access policy reads and relay override forwarding behavior
// pos: concern-focused app-server client suite for approval and sandbox access mapping
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { CodexAppServerClient } from "../src/codex-app-server.mjs";
import { createAccessConfigFakeCodexProcess } from "./helpers/codex-app-server-fixtures.mjs";

test("resumeThread returns the current thread access configuration", async () => {
  const client = new CodexAppServerClient({
    processFactory: () => createAccessConfigFakeCodexProcess(),
  });

  await client.start();
  const result = await client.resumeThread("thread-access");

  assert.equal(result.approvalPolicy, "never");
  assert.deepEqual(result.sandbox, { type: "dangerFullAccess" });
  assert.equal(result.thread.id, "thread-access");

  await client.close();
});

test("relayText forwards access overrides to resume and turn start", async () => {
  let fakeProcess;
  const client = new CodexAppServerClient({
    processFactory: () => {
      fakeProcess = createAccessConfigFakeCodexProcess();
      return fakeProcess;
    },
  });

  await client.start();
  await client.relayText({
    threadId: "thread-access",
    text: "continue",
    approvalPolicy: "on-request",
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: ["D:\\project-a"],
      readOnlyAccess: { type: "fullAccess" },
      networkAccess: true,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
    cwd: "D:\\project-a",
  });

  assert.equal(fakeProcess.getCapturedResumeParams().approvalPolicy, "on-request");
  assert.equal(fakeProcess.getCapturedResumeParams().sandbox, "workspace-write");
  assert.equal(fakeProcess.getCapturedTurnStartParams().approvalPolicy, "on-request");
  assert.deepEqual(fakeProcess.getCapturedTurnStartParams().sandboxPolicy, {
    type: "workspaceWrite",
    writableRoots: ["D:\\project-a"],
    readOnlyAccess: { type: "fullAccess" },
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  });

  await client.close();
});

test("resumeThread converts full sandbox policy overrides into sandbox mode", async () => {
  let fakeProcess;
  const client = new CodexAppServerClient({
    processFactory: () => {
      fakeProcess = createAccessConfigFakeCodexProcess();
      return fakeProcess;
    },
  });

  await client.start();
  await client.resumeThread("thread-access", {
    sandboxPolicy: { type: "dangerFullAccess" },
  });

  assert.equal(fakeProcess.getCapturedResumeParams().sandbox, "danger-full-access");

  await client.close();
});
