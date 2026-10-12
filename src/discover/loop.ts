import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { PolicyDenied, assertActionAllowed, assertHostAllowed, isIrreversibleName, loadPolicy, type PolicyConfig } from "../policy/policy.ts";
import { absoluteUrl } from "../replay/resolve.ts";
import type { Capability } from "../schema/capability.ts";
import { LocateError } from "../surface/locate.ts";
import type { PlaywrightSurface } from "../surface/playwright-surface.ts";
import type { Control } from "../surface/types.ts";
import { ModelActionError, type ProposedAction } from "./action.ts";
import { compileTrace, pathname, type TraceStep } from "./compile.ts";
import type { ModelClient, ModelTurn } from "./model.ts";

export type DiscoverRequest = {
  goal: string;
  origin: string;
  maxSteps: number;
  concreteInput: string;
  name: string;
  description: string;
  appId: string;
  input: { name: string; description: string; pattern: string };
  output: { name: string; description: string; pattern: string };
  outcomes: { code: string; whenText: string; description: string }[];
};

export type TrajectoryStep = {
  index: number;
  action: string;
  reason: string;
  result: "ok" | "refused" | "not_found" | "rejected";
  detail: string;
  url: string;
  screenshot?: string;
};

export type Trajectory = {
  id: string;
  goal: string;
  status: "success" | "exhausted";
  steps: TrajectoryStep[];
};

export type DiscoveryResult =
  | { status: "success"; capability: Capability; trajectory: Trajectory }
  | { status: "exhausted"; trajectory: Trajectory };

export async function discover(
  surface: PlaywrightSurface,
  model: ModelClient,
  request: DiscoverRequest,
  evidenceDir: string,
  policy: PolicyConfig = loadPolicy(),
): Promise<DiscoveryResult> {
  await mkdir(evidenceDir, { recursive: true });
  const trace: TraceStep[] = [];
  const steps: TrajectoryStep[] = [];
  const recent: string[] = [];
  let extracted: string | undefined;
  const outputPattern = new RegExp(request.output.pattern);

  const checkpointMet = (): boolean => {
    const path = pathname(locationPath(surface.currentUrl()));
    return path === `/members/${request.concreteInput}` && Boolean(extracted) && outputPattern.test(extracted ?? "");
  };

  try {
    for (let index = 1; index <= request.maxSteps; index += 1) {
      const observation = await surface.observe();
      if (checkpointMet()) break;

      const turn: ModelTurn = {
        goal: request.goal,
        url: surface.currentUrl(),
        controls: observation.controls.map((control) => ({
          role: control.role,
          name: control.name,
          inFrame: control.inFrame,
        })),
        recent,
        checkpointMet: false,
        outputName: request.output.name,
      };

      let proposed: ProposedAction;
      try {
        proposed = await model.nextAction(turn);
      } catch (error) {
        if (!(error instanceof ModelActionError)) throw error;
        const detail = error.message;
        steps.push(await record(surface, evidenceDir, index, "unparsed", "", "rejected", detail));
        recent.push(`${index}. unparsed → rejected: ${detail}`);
        continue;
      }

      const actionLabel = describeAction(proposed);
      if (proposed.action === "done") {
        const detail = "The savings balance is not on this page yet.";
        steps.push(await record(surface, evidenceDir, index, actionLabel, proposed.reason, "rejected", detail));
        recent.push(`${actionLabel} → rejected: ${detail}`);
        continue;
      }

      const pathBefore = locationPath(surface.currentUrl());
      try {
        const acted = await runProposed(surface, policy, request, proposed, observation.controls, outputPattern);
        const pathAfter = locationPath(surface.currentUrl());
        if (acted.extracted && outputPattern.test(acted.extracted) && acted.bind === request.output.name) {
          extracted = acted.extracted;
        }
        trace.push({ ...acted.step, pathBefore, pathAfter, ok: acted.ok });
        const shot = await record(surface, evidenceDir, index, actionLabel, proposed.reason, acted.result, acted.detail);
        steps.push(shot);
        recent.push(`${actionLabel} → ${acted.result}: ${acted.detail}`);
      } catch (error) {
        const refused = error instanceof PolicyDenied;
        const detail = error instanceof Error ? error.message : String(error);
        const result = refused ? "refused" : "not_found";
        trace.push({
          action: proposed.action,
          path: proposed.action === "navigate" ? proposed.path : undefined,
          role: "role" in proposed ? proposed.role : undefined,
          name: "name" in proposed ? proposed.name : undefined,
          text: proposed.action === "type" ? proposed.text : undefined,
          nearbyText: proposed.action === "extract" ? proposed.nearbyText : undefined,
          bind: proposed.action === "extract" ? proposed.bind : undefined,
          pathBefore,
          pathAfter: pathBefore,
          ok: false,
        });
        steps.push(await record(surface, evidenceDir, index, actionLabel, proposed.reason, result, detail));
        recent.push(`${actionLabel} → ${result}: ${detail}`);
      }
    }
  } catch (error) {
    await writeTrajectory(evidenceDir, request.goal, "exhausted", steps);
    throw error;
  }

  if (!checkpointMet() || !extracted) {
    const trajectory = await writeTrajectory(evidenceDir, request.goal, "exhausted", steps);
    return { status: "exhausted", trajectory };
  }

  try {
    const capability = compileTrace({
      name: request.name,
      description: request.description,
      appId: request.appId,
      input: request.input,
      output: request.output,
      outcomes: request.outcomes,
      concreteInput: request.concreteInput,
      trace,
    });
    await writeFile(join(evidenceDir, "capability.json"), `${JSON.stringify(capability, null, 2)}\n`);
    const trajectory = await writeTrajectory(evidenceDir, request.goal, "success", steps);
    return { status: "success", capability, trajectory };
  } catch (error) {
    await writeTrajectory(evidenceDir, request.goal, "exhausted", steps);
    throw error;
  }
}

type Acted = {
  ok: boolean;
  result: "ok" | "rejected";
  detail: string;
  extracted?: string;
  bind?: string;
  step: Omit<TraceStep, "pathBefore" | "pathAfter" | "ok">;
};

async function runProposed(
  surface: PlaywrightSurface,
  policy: PolicyConfig,
  request: DiscoverRequest,
  proposed: Exclude<ProposedAction, { action: "done" }>,
  controls: Control[],
  outputPattern: RegExp,
): Promise<Acted> {
  assertActionAllowed(policy, proposed.action);
  if (proposed.action === "navigate") {
    const path = appPath(request.origin, proposed.path, policy);
    await surface.act({ type: "navigate", url: absoluteUrl(request.origin, path) });
    return {
      ok: true,
      result: "ok",
      detail: path,
      step: { action: "navigate", path },
    };
  }

  assertHostAllowed(policy, surface.currentUrl());
  if (proposed.action === "click" && isIrreversibleName(policy, proposed.name)) {
    throw new PolicyDenied(`Refused to click irreversible control "${proposed.name}".`);
  }

  if (proposed.action === "type" || proposed.action === "click") {
    const match = controls.find((control) => control.role === proposed.role && control.name === proposed.name);
    if (!match) throw new LocateError(`Could not find ${proposed.role} "${proposed.name}".`);
    if (proposed.action === "type") {
      await surface.act({ type: "type", target: { role: match.role, name: match.name }, text: proposed.text });
      return {
        ok: true,
        result: "ok",
        detail: `entered ${proposed.text}`,
        step: { action: "type", role: match.role, name: match.name, text: proposed.text },
      };
    }
    await surface.act({ type: "click", target: { role: match.role, name: match.name } });
    return {
      ok: true,
      result: "ok",
      detail: `${match.role} "${match.name}"`,
      step: { action: "click", role: match.role, name: match.name },
    };
  }

  const label = controls.find((control) => control.name === proposed.nearbyText);
  if (!label) throw new LocateError(`Could not find text "${proposed.nearbyText}".`);
  const result = await surface.act({ type: "extract", target: { nearbyText: proposed.nearbyText } });
  const text = result.text ?? "";
  const matches = proposed.bind === request.output.name && outputPattern.test(text);
  return {
    ok: matches,
    result: matches ? "ok" : "rejected",
    detail: matches ? `read ${text}` : `extracted text did not match ${request.output.name}`,
    extracted: text,
    bind: proposed.bind,
    step: {
      action: "extract",
      role: label.role,
      name: label.name,
      nearbyText: proposed.nearbyText,
      bind: proposed.bind,
      extracted: text,
    },
  };
}

function appPath(origin: string, path: string, policy: PolicyConfig): string {
  if (/^https?:\/\//i.test(path)) {
    assertHostAllowed(policy, path);
    const url = new URL(path);
    if (url.origin !== new URL(origin).origin) {
      throw new PolicyDenied(`Refused to navigate outside ${new URL(origin).origin}.`);
    }
    return `${pathname(url.pathname)}${url.search}`;
  }
  if (!path.startsWith("/")) throw new PolicyDenied(`Path "${path}" must start with /.`);
  const normalized = `${pathname(path.split("?")[0] ?? path)}${path.includes("?") ? `?${path.split("?").slice(1).join("?")}` : ""}`;
  assertHostAllowed(policy, absoluteUrl(origin, normalized));
  return normalized;
}

function describeAction(action: ProposedAction): string {
  if (action.action === "navigate") return `navigate ${action.path}`;
  if (action.action === "click") return `click ${action.role} "${action.name}"`;
  if (action.action === "type") return `type ${action.role} "${action.name}"`;
  if (action.action === "extract") return `extract nearby "${action.nearbyText}"`;
  return "done";
}

function locationPath(url: string): string {
  if (!url.startsWith("http")) return "/";
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

async function record(
  surface: PlaywrightSurface,
  evidenceDir: string,
  index: number,
  action: string,
  reason: string,
  result: TrajectoryStep["result"],
  detail: string,
): Promise<TrajectoryStep> {
  const file = `${String(index).padStart(2, "0")}.png`;
  await surface.screenshot(join(evidenceDir, file));
  return { index, action, reason, result, detail, url: surface.currentUrl(), screenshot: file };
}

async function writeTrajectory(
  evidenceDir: string,
  goal: string,
  status: Trajectory["status"],
  steps: TrajectoryStep[],
): Promise<Trajectory> {
  const trajectory: Trajectory = { id: basename(evidenceDir), goal, status, steps };
  await writeFile(join(evidenceDir, "trajectory.json"), `${JSON.stringify(trajectory, null, 2)}\n`);
  return trajectory;
}
