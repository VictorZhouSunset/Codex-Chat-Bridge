import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync as defaultExistsSync } from "node:fs";
import { readFile as defaultReadFile, unlink as defaultUnlink } from "node:fs/promises";

const launchedBridgeRoots = new Set();

export function resolveTrayCompanionLaunch({
  bridgeRoot,
  platform = process.platform,
  existsSync = defaultExistsSync,
} = {}) {
  if (!bridgeRoot) {
    throw new Error("resolveTrayCompanionLaunch requires bridgeRoot.");
  }

  const trayRoot = path.join(bridgeRoot, "tray-companion");
  const builtExecutable = path.join(
    trayRoot,
    "target",
    "release",
    platform === "win32" ? "tray-companion.exe" : "tray-companion",
  );

  if (existsSync(builtExecutable)) {
    return {
      kind: "built",
      command: builtExecutable,
      args: [],
      cwd: trayRoot,
    };
  }

  return {
    kind: "dev",
    command: "cargo",
    args: [
      "run",
      "--manifest-path",
      path.join(trayRoot, "Cargo.toml"),
      "--bin",
      "tray-companion",
      "--",
    ],
    cwd: trayRoot,
  };
}

export function createTrayCompanionLauncher({
  bridgeRoot,
  controlPort = 47821,
  platform = process.platform,
  existsSync = defaultExistsSync,
  readPidFileFn = readTrayPidFile,
  processAliveFn = isProcessAlive,
  unlinkFn = defaultUnlink,
  spawnFn = spawn,
} = {}) {
  if (!bridgeRoot) {
    throw new Error("createTrayCompanionLauncher requires bridgeRoot.");
  }

  let launchPromise = null;
  const pidFilePath = path.join(bridgeRoot, "tray-companion.pid");

  return {
    async ensureStarted() {
      if (launchPromise) {
        return launchPromise;
      }

      launchPromise = (async () => {
        const existingPid = await readPidFileFn(pidFilePath);
        if (existingPid?.pid && processAliveFn(existingPid.pid)) {
          launchedBridgeRoots.add(bridgeRoot);
          return { launched: false, alreadyLaunched: true, pid: existingPid.pid };
        }

        if (existingPid?.pid) {
          await unlinkIfExists(unlinkFn, pidFilePath);
        }

        if (launchedBridgeRoots.has(bridgeRoot) && !existingPid?.pid) {
          return { launched: false, alreadyLaunched: true };
        }

        const launch = resolveTrayCompanionLaunch({
          bridgeRoot,
          platform,
          existsSync,
        });

        const child = spawnFn(launch.command, launch.args, {
          cwd: launch.cwd,
          detached: true,
          env: {
            ...process.env,
            TELEGRAM_BRIDGE_BASE_URL: `http://127.0.0.1:${controlPort}`,
            TELEGRAM_BRIDGE_PID_FILE: pidFilePath,
          },
          stdio: "ignore",
          windowsHide: true,
        });

        child.on?.("exit", () => {
          launchedBridgeRoots.delete(bridgeRoot);
        });
        child.on?.("error", () => {
          launchedBridgeRoots.delete(bridgeRoot);
        });
        child.unref?.();
        launchedBridgeRoots.add(bridgeRoot);

        return {
          launched: true,
          alreadyLaunched: false,
          ...launch,
        };
      })();

      try {
        return await launchPromise;
      } finally {
        launchPromise = null;
      }
    },
  };
}

export function resetTrayCompanionLaunchStateForTests() {
  launchedBridgeRoots.clear();
}

async function readTrayPidFile(pidFilePath) {
  try {
    const content = await defaultReadFile(pidFilePath, "utf8");
    const parsed = JSON.parse(content);
    if (typeof parsed?.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0) {
      return { pid: parsed.pid };
    }
  } catch {}

  return null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function unlinkIfExists(unlinkFn, filePath) {
  try {
    await unlinkFn(filePath);
  } catch {}
}
