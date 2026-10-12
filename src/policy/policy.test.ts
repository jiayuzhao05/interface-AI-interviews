import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertActionAllowed,
  assertHostAllowed,
  isIrreversibleName,
  loadPolicy,
  PolicyDenied,
} from "./policy.ts";

const policy = loadPolicy();

test("the shipped allowlist is the local app and the four actions", () => {
  assert.deepEqual(policy.allowedHosts, ["127.0.0.1"]);
  assert.deepEqual(policy.allowedActions, ["navigate", "click", "type", "extract"]);
  assert.deepEqual(policy.irreversibleNames, ["Confirm", "Submit", "Transfer", "Delete"]);
});

test("other hosts and action types are refused", () => {
  assert.throws(() => assertHostAllowed(policy, "https://example.com/members"), PolicyDenied);
  assert.throws(() => assertHostAllowed(policy, "http://localhost:4173/members"), PolicyDenied);
  assert.throws(() => assertActionAllowed(policy, "hover"), PolicyDenied);
  assert.doesNotThrow(() => assertHostAllowed(policy, "http://127.0.0.1:4173/members"));
  assert.doesNotThrow(() => assertActionAllowed(policy, "extract"));
});

test("irreversible names match the button name exactly, ignoring case", () => {
  assert.equal(isIrreversibleName(policy, "Confirm"), true);
  assert.equal(isIrreversibleName(policy, " submit "), true);
  assert.equal(isIrreversibleName(policy, "Look up"), false);
  assert.equal(isIrreversibleName(policy, "Nothing has been submitted."), false);
});
