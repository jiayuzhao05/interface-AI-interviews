import type { Capability, VariantOverlay } from "../schema/capability.ts";
import type { Control, Target } from "../surface/types.ts";

export type PageSignal =
  | { kind: "clear" }
  | { kind: "outcome"; code: string; observed: string }
  | { kind: "recoverable"; id: string; target: Target; observed: string }
  | { kind: "session_expired"; observed: string }
  | { kind: "unknown_dialog"; observed: string };

const sessionExpired = /session expired/i;
const validationError = /is required\./i;

/** Business results win, then expiry, then a notice we know how to close, then an unknown dialog. */
export function classifyPage(controls: Control[], capability: Capability, variant?: VariantOverlay): PageSignal {
  const names = controls.map((control) => control.name).filter((name) => name.length > 0);

  for (const outcome of capability.outcomes) {
    const observed = names.find((name) => name === outcome.whenText || name.includes(outcome.whenText));
    if (observed) return { kind: "outcome", code: outcome.code, observed };
  }

  const invalid = names.find((name) => validationError.test(name));
  if (invalid) return { kind: "outcome", code: "validation_error", observed: invalid };

  const expired = names.find((name) => sessionExpired.test(name));
  if (expired) return { kind: "session_expired", observed: expired };

  for (const notice of variant?.recoverable ?? []) {
    const observed = names.find((name) => name === notice.whenText || name.includes(notice.whenText));
    if (observed) return { kind: "recoverable", id: notice.id, target: notice.target, observed };
  }

  const dialog = controls.find((control) => control.role === "dialog" || control.role === "alertdialog");
  if (dialog) {
    const observed = dialog.name || `${dialog.role} with no name`;
    return { kind: "unknown_dialog", observed };
  }

  return { kind: "clear" };
}

export function summarizeControls(controls: Control[]): string {
  if (controls.length === 0) return "no controls";
  return controls
    .slice(0, 12)
    .map((control) => `${control.role} "${control.name}"`)
    .join("; ");
}
