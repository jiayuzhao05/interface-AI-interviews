import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCapability, loadVariant, type Capability, type VariantOverlay } from "../schema/capability.ts";

export type CatalogField = {
  name: string;
  type: "string";
  description: string;
  required?: boolean;
  pattern?: string;
};

export type CatalogEntry = {
  name: string;
  version: number;
  description: string;
  inputs: CatalogField[];
  outputs: CatalogField[];
  variants: { id: string; description: string }[];
};

export type CatalogDocument = {
  capabilities: CatalogEntry[];
};

export class CatalogError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CatalogError";
    this.status = status;
  }
}

export function loadCatalog(root = capabilitiesDir()): Capability[] {
  const capabilities = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, "v1.json"))
    .filter((path) => existsSync(path))
    .map((path) => loadCapability(path))
    .sort((left, right) => left.name.localeCompare(right.name));
  const seen = new Set<string>();
  for (const capability of capabilities) {
    if (seen.has(capability.name)) throw new Error(`Duplicate capability "${capability.name}".`);
    seen.add(capability.name);
  }
  return capabilities;
}

export function loadVariantOverlays(root = variantsDir()): VariantOverlay[] {
  return readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .map((name) => loadVariant(join(root, name)))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function catalogDocument(capabilities: Capability[], variants: VariantOverlay[]): CatalogDocument {
  return {
    capabilities: capabilities.map((capability) => ({
      name: capability.name,
      version: capability.version,
      description: capability.description,
      inputs: capability.inputs.map((input) => field(input)),
      outputs: capability.outputs.map((output) => field(output)),
      variants: variants
        .filter((variant) => variant.appId === capability.appId)
        .map((variant) => ({ id: variant.id, description: variant.description })),
    })),
  };
}

export function parseInvoke(
  capability: Capability,
  variants: VariantOverlay[],
  body: unknown,
): { params: Record<string, string>; variant?: VariantOverlay } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CatalogError(400, "Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  const variant = resolveVariant(capability, variants, record.variant);
  return { params: parseParams(capability, record.params), variant };
}

function parseParams(capability: Capability, value: unknown): Record<string, string> {
  if (value === undefined) throw new CatalogError(400, "params is required.");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogError(400, "params must be an object of strings.");
  }
  const record = value as Record<string, unknown>;
  const known = new Set(capability.inputs.map((input) => input.name));
  for (const key of Object.keys(record)) {
    if (!known.has(key)) throw new CatalogError(400, `Unknown parameter "${key}".`);
    if (typeof record[key] !== "string") throw new CatalogError(400, `Parameter "${key}" must be a string.`);
  }
  const params: Record<string, string> = {};
  for (const input of capability.inputs) {
    const param = record[input.name];
    if (typeof param !== "string") {
      if (input.required) throw new CatalogError(400, `Missing parameter "${input.name}".`);
      continue;
    }
    if (input.pattern && !new RegExp(input.pattern).test(param)) {
      throw new CatalogError(400, `Parameter "${input.name}" does not match ${input.pattern}.`);
    }
    params[input.name] = param;
  }
  return params;
}

function resolveVariant(capability: Capability, variants: VariantOverlay[], value: unknown): VariantOverlay | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new CatalogError(400, "variant must be a variant id.");
  const variant = variants.find((item) => item.id === value);
  if (!variant) throw new CatalogError(400, `Unknown variant "${value}".`);
  if (variant.appId !== capability.appId) {
    throw new CatalogError(400, `Variant "${value}" does not apply to ${capability.name}.`);
  }
  return variant;
}

function field(value: { name: string; type: "string"; description: string; required?: boolean; pattern?: string }): CatalogField {
  return {
    name: value.name,
    type: value.type,
    description: value.description,
    ...(value.required === undefined ? {} : { required: value.required }),
    ...(value.pattern ? { pattern: value.pattern } : {}),
  };
}

function capabilitiesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../capabilities");
}

function variantsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../variants");
}
