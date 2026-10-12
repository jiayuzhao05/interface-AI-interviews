import { parseCapability, type Capability } from "../schema/capability.ts";

export type TraceStep = {
  action: "navigate" | "type" | "click" | "extract";
  path?: string;
  role?: string;
  name?: string;
  text?: string;
  nearbyText?: string;
  bind?: string;
  extracted?: string;
  pathBefore: string;
  pathAfter: string;
  ok: boolean;
};

export type CompileRequest = {
  name: string;
  description: string;
  appId: string;
  input: { name: string; description: string; pattern: string };
  output: { name: string; description: string; pattern: string };
  outcomes: { code: string; whenText: string; description: string }[];
  concreteInput: string;
  trace: TraceStep[];
};

/**
 * Turns a successful discovery trace into a capability.
 * Trial steps are dropped. The typed value and the matching path segment become
 * {{inputs.<name>}}, which is the /members/:memberId form replay already fills.
 * Click and type locators are the role and name of the control that was used.
 * Extract keeps the label as nearby text, because the value's own name changes on every member.
 */
export function compileTrace(request: CompileRequest): Capability {
  const kept = selectKept(request.trace, request.concreteInput, request.output.pattern);
  const template = `{{inputs.${request.input.name}}}`;
  const steps = kept.map((step, index) => toStep(step, request.concreteInput, template, index));
  const successPath = parameterizePath(pathname(kept.at(-1)?.pathAfter ?? ""), request.concreteInput, template);
  const capability = parseCapability({
    name: request.name,
    version: 1,
    description: request.description,
    appId: request.appId,
    surface: "web",
    inputs: [{ ...request.input, type: "string", required: true }],
    outputs: [{ ...request.output, type: "string" }],
    steps,
    success: { path: successPath, outputs: [request.output.name] },
    outcomes: request.outcomes,
  });
  assertParameterized(capability, request);
  return capability;
}

function selectKept(trace: TraceStep[], concreteInput: string, outputPattern: string): TraceStep[] {
  const ok = trace.filter((step) => step.ok);
  const pattern = new RegExp(outputPattern);
  const extractAt = findLastIndex(
    ok,
    (step) => step.action === "extract" && Boolean(step.extracted) && pattern.test(step.extracted ?? ""),
  );
  const extract = ok[extractAt];
  if (!extract) throw new Error("The trace has no extract that matches the output.");

  const successPath = pathname(extract.pathAfter);
  if (!successPath.split("/").includes(concreteInput)) {
    throw new Error(`Success path ${successPath} does not include the input value.`);
  }

  const landingAt = findLastIndex(
    ok.slice(0, extractAt),
    (step) =>
      (step.action === "click" || step.action === "navigate") &&
      pathname(step.pathAfter) === successPath &&
      pathname(step.pathBefore) !== successPath,
  );
  const landing = ok[landingAt];
  if (!landing) throw new Error("The trace never arrived on the success path.");

  if (landing.action === "navigate") return [landing, extract];

  const typedAt = findLastIndex(
    ok.slice(0, landingAt),
    (step) => step.action === "type" && hasConcrete(step.text ?? "", concreteInput),
  );
  const typed = ok[typedAt];
  if (!typed) throw new Error("The trace reached the detail page without typing the input value.");

  const formPath = pathname(typed.pathBefore);
  const openerAt = findLastIndex(
    ok.slice(0, typedAt),
    (step) => step.action === "navigate" && pathname(step.path ?? step.pathAfter) === formPath,
  );
  const opener = ok[openerAt];
  if (!opener) throw new Error(`The trace never navigated to ${formPath}.`);

  const clicks = ok.slice(typedAt + 1, landingAt + 1).filter((step) => step.action === "click" && step.pathAfter !== step.pathBefore);
  return [opener, typed, ...clicks, extract];
}

function toStep(step: TraceStep, concreteInput: string, template: string, index: number): Capability["steps"][number] {
  if (step.action === "navigate") {
    const path = parameterizePath(step.path ?? step.pathAfter, concreteInput, template);
    return { id: stepId("navigate", path, index), action: "navigate", path };
  }
  if (step.action === "type") {
    if (!step.role || !step.name || !step.text) throw new Error("A typed step is missing the control that was used.");
    return {
      id: stepId("type", step.name, index),
      action: "type",
      target: { role: step.role, name: step.name },
      text: parameterizeText(step.text, concreteInput, template),
    };
  }
  if (step.action === "click") {
    if (!step.role || !step.name) throw new Error("A click is missing the control that was used.");
    return {
      id: stepId("click", step.name, index),
      action: "click",
      target: { role: step.role, name: step.name },
    };
  }
  const nearbyText = step.nearbyText ?? step.name;
  if (!nearbyText || !step.bind) throw new Error("An extract is missing the label it read.");
  return {
    id: stepId("extract", nearbyText, index),
    action: "extract",
    target: { nearbyText },
    bind: step.bind,
  };
}

function assertParameterized(capability: Capability, request: CompileRequest): void {
  const serialized = JSON.stringify(capability);
  if (request.concreteInput && serialized.includes(request.concreteInput)) {
    throw new Error("Compiled capability still contains the concrete input.");
  }
  for (const step of request.trace) {
    if (step.extracted && new RegExp(request.output.pattern).test(step.extracted) && serialized.includes(step.extracted)) {
      throw new Error("Compiled capability still contains an extracted value.");
    }
  }
}

function parameterizePath(path: string, concrete: string, template: string): string {
  return pathname(path)
    .split("/")
    .map((segment) => (segment === concrete ? template : segment))
    .join("/");
}

function parameterizeText(text: string, concrete: string, template: string): string {
  if (text.trim() === concrete) return template;
  return text.replace(tokenPattern(concrete), template);
}

function hasConcrete(text: string, concrete: string): boolean {
  return text.trim() === concrete || tokenPattern(concrete).test(text);
}

function tokenPattern(concrete: string): RegExp {
  const escaped = concrete.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!\\d)${escaped}(?!\\d)`, "g");
}

export function pathname(path: string): string {
  const bare = path.split("?")[0] ?? path;
  if (bare.length > 1 && bare.endsWith("/")) return bare.slice(0, -1);
  return bare || "/";
}

function stepId(action: string, label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .replace(/\{\{inputs\.[a-z0-9]+\}\}/gi, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${action}-${slug || index + 1}`;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) return index;
  }
  return -1;
}
