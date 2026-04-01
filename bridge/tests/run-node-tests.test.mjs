// input: test file paths and package-relative roots
// output: verified deterministic serial test-file ordering for the custom JS test runner
// pos: unit test for bridge/scripts/run-node-tests.mjs helper logic
// 一旦我被更新，务必更新我的开头注释以及所属文件夹的md。
import test from "node:test";
import assert from "node:assert/strict";

import { sortNodeTestFiles } from "../scripts/run-node-tests.mjs";

test("sortNodeTestFiles keeps Node test execution deterministic", () => {
  const sorted = sortNodeTestFiles([
    "D:\\repo\\bridge\\tests\\z-last.test.mjs",
    "D:\\repo\\bridge\\tests\\a-first.test.mjs",
    "D:\\repo\\bridge\\tests\\m-middle.test.mjs",
  ]);

  assert.deepEqual(sorted, [
    "D:\\repo\\bridge\\tests\\a-first.test.mjs",
    "D:\\repo\\bridge\\tests\\m-middle.test.mjs",
    "D:\\repo\\bridge\\tests\\z-last.test.mjs",
  ]);
});
