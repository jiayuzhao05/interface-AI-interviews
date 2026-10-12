import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const anyTemplate = /\{\{[\s\S]*?\}\}/g;

const roleStepSchema = z
  .object({
    role: z.string().min(1),
    name: z.string().min(1).optional(),
  })
  .strict();

const targetSchema = z
  .object({
    role: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    landmarkPath: z.array(roleStepSchema).min(1).optional(),
    nearbyText: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((target, ctx) => {
    const hasRoleName = Boolean(target.role && target.name);
    const hasLandmark = Boolean(target.landmarkPath && target.landmarkPath.length > 0);
    const hasNearby = Boolean(target.nearbyText);
    if (!hasRoleName && !hasLandmark && !hasNearby) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A target needs a role and name, a landmark path, or nearby text.",
      });
    }
  });

const inputSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/),
    type: z.literal("string"),
    description: z.string().min(1),
    required: z.boolean(),
    pattern: z.string().min(1).optional(),
  })
  .strict();

const outputSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/),
    type: z.literal("string"),
    description: z.string().min(1),
    pattern: z.string().min(1).optional(),
  })
  .strict();

const navigateStepSchema = z
  .object({
    id: z.string().min(1),
    action: z.literal("navigate"),
    path: z.string().regex(/^\//),
  })
  .strict();

const typeStepSchema = z
  .object({
    id: z.string().min(1),
    action: z.literal("type"),
    target: targetSchema,
    text: z.string().min(1),
  })
  .strict();

const clickStepSchema = z
  .object({
    id: z.string().min(1),
    action: z.literal("click"),
    target: targetSchema,
  })
  .strict();

const extractStepSchema = z
  .object({
    id: z.string().min(1),
    action: z.literal("extract"),
    target: targetSchema,
    bind: z.string().min(1),
  })
  .strict();

const stepSchema = z.discriminatedUnion("action", [
  navigateStepSchema,
  typeStepSchema,
  clickStepSchema,
  extractStepSchema,
]);

const successSchema = z
  .object({
    path: z.string().regex(/^\//),
    outputs: z.array(z.string().min(1)).min(1),
  })
  .strict();

const outcomeSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]*$/),
    whenText: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

export const capabilitySchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    version: z.number().int().positive(),
    description: z.string().min(1),
    appId: z.string().min(1),
    surface: z.literal("web"),
    inputs: z.array(inputSchema).min(1),
    outputs: z.array(outputSchema).min(1),
    steps: z.array(stepSchema).min(1),
    success: successSchema,
    outcomes: z.array(outcomeSchema),
  })
  .strict()
  .superRefine((capability, ctx) => {
    unique(capability.inputs.map((input) => input.name), "input", ctx, ["inputs"]);
    unique(capability.outputs.map((output) => output.name), "output", ctx, ["outputs"]);
    unique(capability.steps.map((step) => step.id), "step id", ctx, ["steps"]);
    unique(capability.outcomes.map((outcome) => outcome.code), "outcome", ctx, ["outcomes"]);
    checkPatterns(capability.inputs, ["inputs"], ctx);
    checkPatterns(capability.outputs, ["outputs"], ctx);

    const inputNames = new Set(capability.inputs.map((input) => input.name));
    const outputNames = new Set(capability.outputs.map((output) => output.name));
    checkTemplateTree(capability, inputNames, ctx, []);

    const binds = capability.steps.flatMap((step) => (step.action === "extract" ? [step.bind] : []));
    for (const output of capability.outputs) {
      const count = binds.filter((bind) => bind === output.name).length;
      if (count !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Output "${output.name}" must be bound by exactly one extract step.`,
          path: ["outputs"],
        });
      }
    }
    for (const [index, step] of capability.steps.entries()) {
      if (step.action === "extract" && !outputNames.has(step.bind)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Extract step "${step.id}" binds unknown output "${step.bind}".`,
          path: ["steps", index, "bind"],
        });
      }
    }
    for (const [index, name] of capability.success.outputs.entries()) {
      if (!outputNames.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Success output "${name}" is not declared.`,
          path: ["success", "outputs", index],
        });
      }
    }
  });

const recoverableSchema = z
  .object({
    id: z.string().min(1),
    whenText: z.string().min(1),
    action: z.literal("click"),
    target: targetSchema,
  })
  .strict();

export const variantSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    appId: z.string().min(1),
    description: z.string().min(1),
    routePrefix: z.string().regex(/^\/[a-z0-9/-]+$/),
    labelMap: z.record(z.string().min(1), z.string().min(1)),
    recoverable: z.array(recoverableSchema),
  })
  .strict()
  .superRefine((variant, ctx) => {
    unique(variant.recoverable.map((item) => item.id), "recoverable id", ctx, ["recoverable"]);
  });

export type Capability = z.infer<typeof capabilitySchema>;
export type VariantOverlay = z.infer<typeof variantSchema>;
export type CapabilityStep = Capability["steps"][number];

export function parseCapability(data: unknown): Capability {
  return capabilitySchema.parse(data);
}

export function parseVariant(data: unknown): VariantOverlay {
  return variantSchema.parse(data);
}

export function loadCapability(path = lookupSavingsBalancePath()): Capability {
  return parseCapability(readJson(path));
}

export function loadVariant(path = horizonVariantPath()): VariantOverlay {
  return parseVariant(readJson(path));
}

export function lookupSavingsBalancePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../capabilities/lookup_savings_balance/v1.json");
}

export function horizonVariantPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../variants/horizon-variant.json");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function unique(values: string[], label: string, ctx: z.RefinementCtx, path: (string | number)[]): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate ${label} "${value}".`,
        path: [...path, index],
      });
    }
    seen.add(value);
  }
}

function checkPatterns(
  fields: { name: string; pattern?: string }[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  for (const [index, field] of fields.entries()) {
    if (!field.pattern) continue;
    try {
      new RegExp(field.pattern);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Pattern for "${field.name}" is not a valid regular expression.`,
        path: [...path, index, "pattern"],
      });
    }
  }
}

function checkTemplateTree(value: unknown, inputNames: Set<string>, ctx: z.RefinementCtx, path: (string | number)[]): void {
  if (typeof value === "string") {
    for (const token of value.match(anyTemplate) ?? []) {
      const match = /^\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\.([a-zA-Z][a-zA-Z0-9]*)\s*\}\}$/.exec(token);
      if (!match || match[1] !== "inputs" || !inputNames.has(match[2] ?? "")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown template ${token}. Use {{inputs.<declared input>}}.`,
          path,
        });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkTemplateTree(item, inputNames, ctx, [...path, index]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      checkTemplateTree(item, inputNames, ctx, [...path, key]);
    }
  }
}
