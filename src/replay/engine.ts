import type { Capability, CapabilityStep, VariantOverlay } from "../schema/capability.ts";
import { PolicyDenied } from "../policy/policy.ts";
import type { PlaywrightSurface } from "../surface/playwright-surface.ts";
import type { Target } from "../surface/types.ts";
import { absoluteUrl, applyLabels, applyRoutePrefix, fillTemplate } from "./resolve.ts";
import { classifyPage, summarizeControls } from "./signals.ts";

const recoverableLimit = 3;

export type ReplayEvidence = {
  notes: { stepId: string; detail: string }[];
  url: string;
  observed: string;
};

export type ReplayFailure = {
  stepId: string;
  category: "target_not_found" | "checkpoint_mismatch" | "session_expired" | "policy_denied";
  expected: string;
  observed: string;
};

export type ReplayResult =
  | { status: "success"; outputs: Record<string, string>; evidence: ReplayEvidence }
  | { status: "outcome"; code: string; outputs: Record<string, string>; evidence: ReplayEvidence }
  | { status: "failed"; failure: ReplayFailure; evidence: ReplayEvidence }
  | {
      status: "escalated";
      stepId: string;
      reason: "unknown_dialog" | "irreversible";
      expected: string;
      observed: string;
      /** True when this step already ran and the signal was found afterward. */
      stepCompleted: boolean;
      outputs: Record<string, string>;
      evidence: ReplayEvidence;
    };

export type ReplayInput = {
  capability: Capability;
  params: Record<string, string>;
  variant?: VariantOverlay;
  origin?: string;
  startIndex?: number;
  seedOutputs?: Record<string, string>;
};

export async function replay(surface: PlaywrightSurface, input: ReplayInput): Promise<ReplayResult> {
  const origin = input.origin ?? "http://127.0.0.1:4173";
  const notes: ReplayEvidence["notes"] = [];
  const outputs: Record<string, string> = { ...(input.seedOutputs ?? {}) };
  const { capability, variant } = input;
  const steps = capability.steps.slice(input.startIndex ?? 0);

  if (variant && variant.appId !== capability.appId) {
    return failed(surface, notes, {
      stepId: capability.steps[0]?.id ?? "variant",
      category: "checkpoint_mismatch",
      expected: `variant for ${capability.appId}`,
      observed: `variant ${variant.id} is for ${variant.appId}`,
    });
  }

  for (const step of steps) {
    const settled = await settle(surface, input, step.id, notes, outputs, false);
    if (settled) return settled;

    const acted = await runStep(surface, input, step, origin, outputs, notes);
    if (acted) return acted;

    const after = await settle(surface, input, step.id, notes, outputs, true);
    if (after) return after;
  }

  const expectedPath = applyRoutePrefix(fillTemplate(capability.success.path, input.params), variant);
  const pathname = currentPath(surface);
  if (pathname !== expectedPath) {
    return failed(surface, notes, {
      stepId: capability.steps.at(-1)?.id ?? "success",
      category: "checkpoint_mismatch",
      expected: `path ${expectedPath}`,
      observed: `path ${pathname}; ${summarizeControls((await surface.observe()).controls)}`,
    });
  }

  for (const name of capability.success.outputs) {
    const value = outputs[name];
    const output = capability.outputs.find((item) => item.name === name);
    if (!value || (output?.pattern && !new RegExp(output.pattern).test(value))) {
      return failed(surface, notes, {
        stepId: capability.steps.at(-1)?.id ?? "success",
        category: "checkpoint_mismatch",
        expected: output?.pattern ? `${name} matching ${output.pattern}` : name,
        observed: value ? `${name}=${value}` : `${name} was not extracted`,
      });
    }
  }

  return { status: "success", outputs, evidence: await evidence(surface, notes) };
}

async function runStep(
  surface: PlaywrightSurface,
  input: ReplayInput,
  step: CapabilityStep,
  origin: string,
  outputs: Record<string, string>,
  notes: ReplayEvidence["notes"],
): Promise<ReplayResult | undefined> {
  const params = input.params;
  const variant = input.variant;
  try {
    if (step.action === "navigate") {
      const path = applyRoutePrefix(fillTemplate(step.path, params), variant);
      const url = absoluteUrl(origin, path);
      await surface.act({ type: "navigate", url });
      notes.push({ stepId: step.id, detail: `navigate ${path}` });
      const pathname = currentPath(surface);
      if (pathname !== path) {
        return failed(surface, notes, {
          stepId: step.id,
          category: "checkpoint_mismatch",
          expected: `path ${path}`,
          observed: `path ${pathname}`,
        });
      }
      return;
    }

    const target = applyLabels(step.target, variant);
    if (step.action === "type") {
      const text = fillTemplate(step.text, params);
      await surface.act({ type: "type", target, text });
      notes.push({ stepId: step.id, detail: `type ${describeTarget(target)}` });
      return;
    }
    if (step.action === "click") {
      await surface.act({ type: "click", target });
      notes.push({ stepId: step.id, detail: `click ${describeTarget(target)}` });
      return;
    }

    const result = await surface.act({ type: "extract", target });
    const text = result.text ?? "";
    outputs[step.bind] = text;
    notes.push({ stepId: step.id, detail: `extract ${step.bind}=${text}` });
    const output = input.capability.outputs.find((item) => item.name === step.bind);
    if (output?.pattern && !new RegExp(output.pattern).test(text)) {
      return failed(surface, notes, {
        stepId: step.id,
        category: "checkpoint_mismatch",
        expected: `${step.bind} matching ${output.pattern}`,
        observed: text || "empty text",
      });
    }
  } catch (error) {
    if (error instanceof PolicyDenied && step.action === "click" && error.message.includes("irreversible")) {
      return {
        status: "escalated",
        stepId: step.id,
        reason: "irreversible",
        expected: "a person to decide on this click",
        observed: error.message,
        stepCompleted: false,
        outputs,
        evidence: await evidence(surface, notes, error.message),
      };
    }
    const category = error instanceof PolicyDenied ? "policy_denied" : "target_not_found";
    const expected =
      step.action === "navigate"
        ? `path ${applyRoutePrefix(fillTemplate(step.path, params), variant)}`
        : describeTarget(applyLabels(step.target, variant));
    return failed(surface, notes, {
      stepId: step.id,
      category,
      expected,
      observed: error instanceof Error ? error.message : String(error),
    });
  }
}

async function settle(
  surface: PlaywrightSurface,
  input: ReplayInput,
  stepId: string,
  notes: ReplayEvidence["notes"],
  outputs: Record<string, string>,
  stepCompleted: boolean,
): Promise<ReplayResult | undefined> {
  for (let attempt = 0; attempt < recoverableLimit; attempt += 1) {
    const seen = await surface.observe();
    const signal = classifyPage(seen.controls, input.capability, input.variant);
    if (signal.kind === "clear") return;
    if (signal.kind === "outcome") {
      return { status: "outcome", code: signal.code, outputs, evidence: await evidence(surface, notes, signal.observed) };
    }
    if (signal.kind === "session_expired") {
      return failed(surface, notes, {
        stepId,
        category: "session_expired",
        expected: "an active session",
        observed: signal.observed,
      });
    }
    if (signal.kind === "unknown_dialog") {
      return {
        status: "escalated",
        stepId,
        reason: "unknown_dialog",
        expected: "no unknown dialog",
        observed: signal.observed,
        stepCompleted,
        outputs,
        evidence: await evidence(surface, notes, signal.observed),
      };
    }
    notes.push({ stepId, detail: `Dismissed "${signal.observed}" via ${signal.id}.` });
    try {
      await surface.act({ type: "click", target: signal.target });
    } catch (error) {
      return failed(surface, notes, {
        stepId,
        category: error instanceof PolicyDenied ? "policy_denied" : "target_not_found",
        expected: `dismiss ${signal.observed} with ${describeTarget(signal.target)}`,
        observed: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const seen = await surface.observe();
  return failed(surface, notes, {
    stepId,
    category: "checkpoint_mismatch",
    expected: "registered notices to clear",
    observed: summarizeControls(seen.controls),
  });
}

function currentPath(surface: PlaywrightSurface): string {
  return new URL(surface.currentUrl()).pathname;
}

function describeTarget(target: Target): string {
  const parts: string[] = [];
  if (target.role || target.name) parts.push(`${target.role ?? "control"} "${target.name ?? ""}"`);
  if (target.nearbyText) parts.push(`near "${target.nearbyText}"`);
  if (target.landmarkPath?.length) {
    parts.push(`under ${target.landmarkPath.map((step) => step.name ?? step.role).join(" > ")}`);
  }
  return parts.join(", ") || "control";
}

async function evidence(surface: PlaywrightSurface, notes: ReplayEvidence["notes"], observed?: string): Promise<ReplayEvidence> {
  const seen = await surface.observe();
  return {
    notes,
    url: surface.currentUrl(),
    observed: observed ?? summarizeControls(seen.controls),
  };
}

async function failed(
  surface: PlaywrightSurface,
  notes: ReplayEvidence["notes"],
  failure: ReplayFailure,
): Promise<ReplayResult> {
  return { status: "failed", failure, evidence: await evidence(surface, notes, failure.observed) };
}
