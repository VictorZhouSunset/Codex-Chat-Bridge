// input: fake tray launcher dependencies, temporary pid files, and repo-local Cargo manifest paths
// output: verified tray launcher spawn/reuse decisions and manifest expectations
// pos: integration-style test for the Node-side tray companion launcher
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createTrayCompanionLauncher,
  resetTrayCompanionLaunchStateForTests,
  resolveTrayCompanionLaunch,
} from "../src/tray-companion.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoBridgeRoot = path.resolve(__dirname, "..");

test.beforeEach(() => {
  resetTrayCompanionLaunchStateForTests();
});

test("resolveTrayCompanionLaunch prefers the built tray executable when present", () => {
  const bridgeRoot = repoBridgeRoot;

  const launch = resolveTrayCompanionLaunch({
    bridgeRoot,
    platform: "win32",
    existsSync: (candidatePath) =>
      candidatePath ===
      path.join(
        bridgeRoot,
        "tray-companion",
        "target",
        "release",
        "tray-companion.exe",
      ),
  });

  assert.deepEqual(launch, {
    kind: "built",
    command: path.join(
      bridgeRoot,
      "tray-companion",
      "target",
      "release",
      "tray-companion.exe",
    ),
    args: [],
    cwd: path.join(bridgeRoot, "tray-companion"),
  });
});

test("resolveTrayCompanionLaunch falls back to the dev cargo command when the executable is missing", () => {
  const bridgeRoot = repoBridgeRoot;

  const launch = resolveTrayCompanionLaunch({
    bridgeRoot,
    platform: "win32",
    existsSync: () => false,
  });

  assert.deepEqual(launch, {
    kind: "dev",
    command: "cargo",
    args: [
      "run",
      "--manifest-path",
      path.join(bridgeRoot, "tray-companion", "Cargo.toml"),
      "--bin",
      "tray-companion",
      "--",
    ],
    cwd: path.join(bridgeRoot, "tray-companion"),
  });
});

test("createTrayCompanionLauncher only spawns the tray once per bridge process", async () => {
  const bridgeRoot = repoBridgeRoot;
  const spawnCalls = [];

  const launcher = createTrayCompanionLauncher({
    bridgeRoot,
    platform: "win32",
    existsSync: (candidatePath) =>
      candidatePath ===
      path.join(
        bridgeRoot,
        "tray-companion",
        "target",
        "release",
        "tray-companion.exe",
      ),
    readPidFileFn: async () => null,
    spawnFn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return { unref() {} };
    },
  });

  const firstLaunch = await launcher.ensureStarted();
  const secondLaunch = await launcher.ensureStarted();

  assert.equal(spawnCalls.length, 1);
  assert.equal(firstLaunch.launched, true);
  assert.equal(secondLaunch.launched, false);
});

test("createTrayCompanionLauncher passes the live bridge base URL to the tray child", async () => {
  const bridgeRoot = repoBridgeRoot;
  const spawnCalls = [];

  const launcher = createTrayCompanionLauncher({
    bridgeRoot,
    controlPort: 47821,
    platform: "win32",
    existsSync: () => false,
    readPidFileFn: async () => null,
    spawnFn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return { on() {}, unref() {} };
    },
  });

  await launcher.ensureStarted();

  assert.equal(spawnCalls.length, 1);
  assert.equal(
    spawnCalls[0].options.env.TELEGRAM_BRIDGE_BASE_URL,
    "http://127.0.0.1:47821",
  );
});

test("createTrayCompanionLauncher reuses an already-running tray process across bridge restarts", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tray-launcher-test-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const spawnCalls = [];
  const pidFilePath = path.join(tempDir, "tray-companion.pid");
  await writeFile(pidFilePath, JSON.stringify({ pid: 4242 }), "utf8");

  const launcher = createTrayCompanionLauncher({
    bridgeRoot: tempDir,
    controlPort: 47821,
    platform: "win32",
    existsSync: () => true,
    readPidFileFn: async () => ({ pid: 4242 }),
    processAliveFn: () => true,
    spawnFn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return { on() {}, unref() {} };
    },
  });

  const launch = await launcher.ensureStarted();

  assert.equal(launch.launched, false);
  assert.equal(launch.alreadyLaunched, true);
  assert.equal(spawnCalls.length, 0);
});

test("createTrayCompanionLauncher replaces a stale tray pid file with a new tray process", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tray-launcher-test-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const spawnCalls = [];

  const launcher = createTrayCompanionLauncher({
    bridgeRoot: tempDir,
    controlPort: 47821,
    platform: "win32",
    existsSync: () => true,
    readPidFileFn: async () => ({ pid: 4242 }),
    processAliveFn: () => false,
    spawnFn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return { on() {}, unref() {} };
    },
  });

  const launch = await launcher.ensureStarted();

  assert.equal(launch.launched, true);
  assert.equal(launch.alreadyLaunched, false);
  assert.equal(spawnCalls.length, 1);
});

test("createTrayCompanionLauncher relaunches the tray when it dies after an earlier successful start", async () => {
  const bridgeRoot = repoBridgeRoot;
  const spawnCalls = [];
  let phase = "first-start";

  const launcher = createTrayCompanionLauncher({
    bridgeRoot,
    controlPort: 47821,
    platform: "win32",
    existsSync: () => true,
    readPidFileFn: async () => {
      if (phase === "first-start") {
        return null;
      }
      return { pid: 4242 };
    },
    processAliveFn: () => phase !== "relaunch-needed",
    spawnFn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return { on() {}, unref() {} };
    },
  });

  const firstLaunch = await launcher.ensureStarted();
  phase = "relaunch-needed";
  const secondLaunch = await launcher.ensureStarted();

  assert.equal(firstLaunch.launched, true);
  assert.equal(secondLaunch.launched, true);
  assert.equal(secondLaunch.alreadyLaunched, false);
  assert.equal(spawnCalls.length, 2);
});

test("the Cargo manifest exposes the tray binary name used by the launcher", () => {
  const cargoManifestPath = path.join(repoBridgeRoot, "tray-companion", "Cargo.toml");
  const cargoManifest = readFileSync(cargoManifestPath, "utf8");

  assert.match(cargoManifest, /\[\[bin\]\]\s+name = "tray-companion"/s);
});
