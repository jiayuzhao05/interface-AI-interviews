import { z } from "zod";

const reason = z.string().min(1).max(240);

export const proposedActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("navigate"), path: z.string().min(1), reason }),
  z.object({
    action: z.literal("click"),
    role: z.string().min(1),
    name: z.string().min(1),
    reason,
  }),
  z.object({
    action: z.literal("type"),
    role: z.string().min(1),
    name: z.string().min(1),
    text: z.string().min(1),
    reason,
  }),
  z.object({
    action: z.literal("extract"),
    nearbyText: z.string().min(1),
    bind: z.string().min(1),
    reason,
  }),
  z.object({ action: z.literal("done"), reason }),
]);

export type ProposedAction = z.infer<typeof proposedActionSchema>;

export class ModelActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelActionError";
  }
}

/** Reads one action from a model reply. Extra prose and a fenced block are ignored. */
export function parseModelAction(text: string): ProposedAction {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new ModelActionError("Model reply did not contain a JSON action.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new ModelActionError("Model reply was not valid JSON.");
  }
  if (parsed && typeof parsed === "object" && "reason" in parsed) {
    const record = parsed as Record<string, unknown>;
    if (typeof record.reason === "string") record.reason = record.reason.slice(0, 240);
  }
  const result = proposedActionSchema.safeParse(parsed);
  if (!result.success) throw new ModelActionError("Model reply was not a navigate, click, type, extract, or done action.");
  return result.data;
}
