import test from "node:test";
import assert from "node:assert/strict";

import { observeRelayCompletion } from "../src/relay-result.mjs";

test("observeRelayCompletion ignores results without a completion promise", async () => {
  observeRelayCompletion({ kind: "relay" });
  observeRelayCompletion(null);
  assert.ok(true);
});

test("observeRelayCompletion catches async relay failures", async () => {
  const observedErrors = [];

  observeRelayCompletion(
    {
      kind: "relay",
      completion: Promise.reject(new Error("relay failed")),
    },
    (error) => {
      observedErrors.push(error.message);
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(observedErrors, ["relay failed"]);
});
