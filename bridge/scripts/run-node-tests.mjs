// input: bridge test directory paths and Node test file execution requests
// output: deterministic serial execution of all Node test files in bridge/tests
// pos: local gate helper that avoids flaky aggregate node --test behavior in this repo
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bridgeRoot = path.resolve(__dirname, "..");
const testsRoot = path.join(bridgeRoot, "tests");

export function sortNodeTestFiles(files) {
  return [...files].sort((left, right) => left.localeCompare(right));
}

export async function listNodeTestFiles(root = testsRoot) {
  const entries = await readdir(root, { withFileTypes: true });
  return sortNodeTestFiles(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
      .map((entry) => path.join(root, entry.name)),
  );
}

if (
  !process.execArgv.includes("--test") &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const files = await listNodeTestFiles();
  for (const file of files) {
    process.stdout.write(`RUN ${path.basename(file)}\n`);
    await runNodeTestFile(file);
  }
}

async function runNodeTestFile(file) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", file], {
      cwd: bridgeRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (stdout) {
        process.stdout.write(stdout);
      }
      if (stderr) {
        process.stderr.write(stderr);
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Node test failed for ${file} with exit code ${code ?? "unknown"}.`));
    });
  });
}
