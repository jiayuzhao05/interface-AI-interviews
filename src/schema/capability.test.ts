import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ZodError } from "zod";
import {
  horizonVariantPath,
  loadCapability,
  loadVariant,
  lookupSavingsBalancePath,
  parseCapability,
} from "./capability.ts";

const capability = loadCapability();
const variant = loadVariant();

test("the hand-written lookup capability matches the schema", () => {
  assert.equal(capability.name, "lookup_savings_balance");
  assert.equal(capability.version, 1);
  assert.deepEqual(capability.inputs.map((input) => input.name), ["memberId"]);
  assert.deepEqual(capability.outputs.map((output) => output.name), ["savingsBalance"]);
  assert.deepEqual(
    capability.steps.map((step) => step.action),
    ["navigate", "type", "click", "extract"],
  );
  assert.equal(capability.success.path, "/members/{{inputs.memberId}}");
  assert.deepEqual(capability.success.outputs, ["savingsBalance"]);
  assert.deepEqual(capability.outcomes.map((outcome) => outcome.code), ["member_not_found"]);
});

test("member numbers in the capability are templates, not concrete ids", () => {
  const source = readFileSync(lookupSavingsBalancePath(), "utf8");
  const typeStep = capability.steps.find((step) => step.action === "type");
  assert.equal(typeStep?.action === "type" ? typeStep.text : "", "{{inputs.memberId}}");
  assert.equal(source.includes("10001"), false);
  assert.equal(source.includes("10002"), false);
  assert.equal(source.includes("10003"), false);
});

test("the variant overlay carries the route prefix, label, and branch notice", () => {
  assert.equal(variant.routePrefix, "/cu");
  assert.equal(variant.appId, capability.appId);
  assert.equal(variant.labelMap["Member number"], "Account ID");
  assert.deepEqual(variant.recoverable, [
    {
      id: "dismiss-branch-notice",
      whenText: "Branch notice",
      action: "click",
      target: { role: "button", name: "Dismiss" },
    },
  ]);
  const typeStep = capability.steps.find((step) => step.action === "type");
  const fieldName = typeStep?.action === "type" ? typeStep.target.name : undefined;
  assert.equal(fieldName, "Member number");
  assert.equal(variant.labelMap[fieldName ?? ""], "Account ID");
});

test("a template that names an undeclared input is rejected", () => {
  const broken = structuredClone(capability);
  const step = broken.steps.find((item) => item.action === "type");
  if (step?.action === "type") step.text = "{{inputs.account}}";
  assert.throws(() => parseCapability(broken), ZodError);
});

test("the variant file itself parses from disk", () => {
  const fromDisk = loadVariant(horizonVariantPath());
  assert.equal(fromDisk.id, "horizon-variant");
});
