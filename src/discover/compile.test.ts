import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModelAction } from "./action.ts";
import { compileTrace, type TraceStep } from "./compile.ts";
import { lookupRequest } from "./lookup.ts";
import { createModelClient } from "./model.ts";

const request = lookupRequest("10001");

test("a model reply becomes one action and the key stays out of the client error", () => {
  const action = parseModelAction('```json\n{"action":"click","role":"button","name":"Look up","reason":"submit the lookup"}\n```');
  assert.equal(action.action, "click");
  if (action.action === "click") assert.equal(action.name, "Look up");
  assert.throws(() => createModelClient({}), /ANTHROPIC_API_KEY, OPENAI_API_KEY, or XAI_API_KEY/);
});

test("trial steps are dropped and the member id becomes a template", () => {
  const capability = compileTrace({
    ...contract(),
    concreteInput: "10001",
    trace: [
      step({ action: "navigate", path: "/members", pathBefore: "/", pathAfter: "/members" }),
      step({ action: "click", role: "button", name: "Confirm", pathBefore: "/members", pathAfter: "/members", ok: false }),
      step({ action: "type", role: "textbox", name: "Member number", text: "99999", pathBefore: "/members", pathAfter: "/members" }),
      step({
        action: "click",
        role: "button",
        name: "Look up",
        pathBefore: "/members",
        pathAfter: "/members?error=missing&memberNumber=99999",
      }),
      step({ action: "navigate", path: "/members", pathBefore: "/members?error=missing&memberNumber=99999", pathAfter: "/members" }),
      step({ action: "type", role: "textbox", name: "Member number", text: "10001", pathBefore: "/members", pathAfter: "/members" }),
      step({ action: "click", role: "button", name: "Look up", pathBefore: "/members", pathAfter: "/members/10001" }),
      step({
        action: "extract",
        role: "cell",
        name: "Savings balance",
        nearbyText: "Savings balance",
        bind: "savingsBalance",
        extracted: "$4,280.15",
        pathBefore: "/members/10001",
        pathAfter: "/members/10001",
      }),
    ],
  });

  assert.deepEqual(
    capability.steps.map((item) => item.action),
    ["navigate", "type", "click", "extract"],
  );
  const serialized = JSON.stringify(capability);
  assert.equal(serialized.includes("10001"), false);
  assert.equal(serialized.includes("99999"), false);
  assert.equal(serialized.includes("$4,280.15"), false);
  assert.equal(capability.success.path, "/members/{{inputs.memberId}}");
  const typed = capability.steps.find((item) => item.action === "type");
  const clicked = capability.steps.find((item) => item.action === "click");
  const extracted = capability.steps.find((item) => item.action === "extract");
  assert.equal(typed?.action === "type" ? typed.text : "", "{{inputs.memberId}}");
  assert.deepEqual(typed?.action === "type" ? typed.target : {}, { role: "textbox", name: "Member number" });
  assert.deepEqual(clicked?.action === "click" ? clicked.target : {}, { role: "button", name: "Look up" });
  assert.deepEqual(extracted?.action === "extract" ? extracted.target : {}, { nearbyText: "Savings balance" });
});

test("a direct navigation to the detail path is parameterized the same way", () => {
  const capability = compileTrace({
    ...contract(),
    concreteInput: "10001",
    trace: [
      step({ action: "navigate", path: "/members/10001", pathBefore: "/", pathAfter: "/members/10001" }),
      step({
        action: "extract",
        nearbyText: "Savings balance",
        bind: "savingsBalance",
        extracted: "$4,280.15",
        pathBefore: "/members/10001",
        pathAfter: "/members/10001",
      }),
    ],
  });
  assert.deepEqual(
    capability.steps.map((item) => (item.action === "navigate" ? item.path : item.action)),
    ["/members/{{inputs.memberId}}", "extract"],
  );
});

function contract() {
  return {
    name: request.name,
    description: request.description,
    appId: request.appId,
    input: request.input,
    output: request.output,
    outcomes: request.outcomes,
  };
}

function step(overrides: Partial<TraceStep> & Pick<TraceStep, "action" | "pathBefore" | "pathAfter">): TraceStep {
  return { ok: true, ...overrides };
}
