import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCapability, loadVariant } from "../schema/capability.ts";
import type { Control } from "../surface/types.ts";
import { applyLabels, applyRoutePrefix, fillTemplate } from "./resolve.ts";
import { classifyPage } from "./signals.ts";

const capability = loadCapability();
const variant = loadVariant();

function control(role: string, name: string): Control {
  return { role, name, inFrame: false, frameUrl: null };
}

test("templates, route prefixes, and field labels resolve without a model", () => {
  assert.equal(fillTemplate("/members/{{inputs.memberId}}", { memberId: "10001" }), "/members/10001");
  assert.equal(fillTemplate("{{inputs.memberId}}", {}), "");
  assert.equal(applyRoutePrefix("/members", variant), "/cu/members");
  assert.equal(applyRoutePrefix("/members/{{inputs.memberId}}", undefined), "/members/{{inputs.memberId}}");
  const target = applyLabels({ role: "textbox", name: "Member number" }, variant);
  assert.equal(target.name, "Account ID");
});

test("a missing member and a validation message are outcomes", () => {
  const missing = classifyPage([control("cell", "No member matches.")], capability);
  assert.deepEqual(missing, { kind: "outcome", code: "member_not_found", observed: "No member matches." });

  const invalid = classifyPage([control("cell", "Account ID is required.")], capability, variant);
  assert.equal(invalid.kind, "outcome");
  if (invalid.kind === "outcome") assert.equal(invalid.code, "validation_error");
});

test("a registered notice is recoverable and an unknown dialog stops", () => {
  const notice = classifyPage([control("columnheader", "Branch notice"), control("button", "Dismiss")], capability, variant);
  assert.equal(notice.kind, "recoverable");
  if (notice.kind === "recoverable") assert.equal(notice.id, "dismiss-branch-notice");

  const dialog = classifyPage([control("dialog", "Please confirm this transfer")], capability, variant);
  assert.equal(dialog.kind, "unknown_dialog");

  const expired = classifyPage([control("heading", "Session expired")], capability);
  assert.equal(expired.kind, "session_expired");
});
