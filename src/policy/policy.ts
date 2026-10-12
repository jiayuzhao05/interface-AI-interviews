import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const actionTypes = ["navigate", "click", "type", "extract"] as const;

export type ActionType = (typeof actionTypes)[number];

export type PolicyConfig = {
  allowedHosts: string[];
  allowedActions: ActionType[];
  irreversibleNames: string[];
};

export class PolicyDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyDenied";
  }
}

export function defaultPolicyPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../config/policy.json");
}

export function loadPolicy(path = defaultPolicyPath()): PolicyConfig {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isPolicy(parsed)) {
    throw new Error(`Policy file ${path} must list allowedHosts, allowedActions, and irreversibleNames.`);
  }
  return parsed;
}

export function assertActionAllowed(policy: PolicyConfig, action: string): asserts action is ActionType {
  if (!policy.allowedActions.includes(action as ActionType)) {
    throw new PolicyDenied(`Action "${action}" is not on the allowlist.`);
  }
}

export function assertHostAllowed(policy: PolicyConfig, url: string): void {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new PolicyDenied(`Refused to act on invalid URL "${url}".`);
  }
  if (!policy.allowedHosts.includes(hostname)) {
    throw new PolicyDenied(`Host "${hostname || url}" is not on the allowlist.`);
  }
}

export function isIrreversibleName(policy: PolicyConfig, name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return policy.irreversibleNames.some((item) => item.trim().toLowerCase() === normalized);
}

function isPolicy(value: unknown): value is PolicyConfig {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    isStringList(record.allowedHosts) &&
    isStringList(record.allowedActions) &&
    record.allowedActions.every((action) => actionTypes.includes(action as ActionType)) &&
    isStringList(record.irreversibleNames)
  );
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
