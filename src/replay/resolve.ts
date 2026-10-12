import type { VariantOverlay } from "../schema/capability.ts";
import type { Target } from "../surface/types.ts";

const template = /\{\{\s*inputs\.([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

export function fillTemplate(value: string, params: Record<string, string>): string {
  return value.replace(template, (_match, name: string) => params[name] ?? "");
}

export function applyRoutePrefix(path: string, variant?: VariantOverlay): string {
  const prefix = variant?.routePrefix ?? "";
  if (!prefix || path === prefix || path.startsWith(`${prefix}/`)) return path;
  return `${prefix}${path}`;
}

export function applyLabels(target: Target, variant?: VariantOverlay): Target {
  const labelMap = variant?.labelMap ?? {};
  return {
    role: target.role,
    name: target.name ? replaceLabels(target.name, labelMap) : undefined,
    nearbyText: target.nearbyText ? replaceLabels(target.nearbyText, labelMap) : undefined,
    landmarkPath: target.landmarkPath?.map((step) => ({
      role: step.role,
      name: step.name ? replaceLabels(step.name, labelMap) : undefined,
    })),
  };
}

export function absoluteUrl(origin: string, path: string): string {
  return new URL(path, origin).toString();
}

function replaceLabels(text: string, labelMap: Record<string, string>): string {
  if (labelMap[text]) return labelMap[text];
  const keys = Object.keys(labelMap).sort((left, right) => right.length - left.length);
  let next = text;
  for (const key of keys) {
    if (key) next = next.replaceAll(key, labelMap[key] ?? key);
  }
  return next;
}
