import { replay, type ReplayInput, type ReplayResult } from "../replay/engine.ts";
import type { BrowserSession, Intervention } from "./session.ts";

const handoffLimit = 3;

export type SessionRun = {
  result: ReplayResult;
  intervention: Intervention | null;
};

export async function runSession(
  session: BrowserSession,
  input: ReplayInput,
  options: { evidenceDir: string; onHandoff?: (intervention: Intervention) => void },
): Promise<SessionRun> {
  let startIndex = 0;
  let seedOutputs: Record<string, string> = {};
  for (let handoff = 0; handoff <= handoffLimit; handoff += 1) {
    const result = await replay(session.surface, { ...input, startIndex, seedOutputs });
    if (result.status !== "escalated") return { result, intervention: session.intervention };
    if (handoff === handoffLimit) return { result, intervention: session.intervention };

    const stepIndex = input.capability.steps.findIndex((step) => step.id === result.stepId);
    const intervention = await session.handOff({
      capability: input.capability.name,
      stepId: result.stepId,
      reason: result.reason,
      evidenceDir: options.evidenceDir,
    });
    options.onHandoff?.(intervention);
    await session.waitForResume();
    seedOutputs = result.outputs;
    const advance = result.reason === "irreversible" || result.stepCompleted;
    startIndex = (stepIndex < 0 ? startIndex : stepIndex) + (advance ? 1 : 0);
  }
  throw new Error("Handoff loop ended without a result.");
}
