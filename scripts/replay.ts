import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCapability, loadVariant } from "../src/schema/capability.ts";
import { replay, type ReplayResult } from "../src/replay/engine.ts";
import { PlaywrightSurface } from "../src/surface/playwright-surface.ts";

const capabilityPath = process.argv[2];
if (!capabilityPath) {
  console.error("Usage: npm run replay -- capabilities/lookup_savings_balance/v1.json");
  process.exit(1);
}
if (!existsSync(capabilityPath)) {
  if (capabilityPath === "evidence/latest/capability.json") {
    console.error("evidence/latest/capability.json does not exist yet. npm run discover writes it after a successful run.");
    console.error("Replay the checked-in capability:");
    console.error("  npm run replay -- capabilities/lookup_savings_balance/v1.json");
  } else {
    console.error(`No capability file at ${capabilityPath}.`);
  }
  process.exit(1);
}

const origin = process.env.HORIZON_ORIGIN ?? "http://127.0.0.1:4173";
const params = readParams();
const variant = process.env.VARIANT ? loadVariant(process.env.VARIANT) : undefined;
const capability = loadCapability(capabilityPath);

try {
  const probe = await fetch(`${origin}/members`);
  if (!probe.ok) throw new Error(`Horizon returned ${probe.status}.`);
} catch {
  console.error("The sample app is not running. Start it with npm run horizon.");
  process.exit(1);
}

const surface = await PlaywrightSurface.launch({ headless: process.env.HEADED !== "1" });
try {
  const result = await replay(surface, { capability, params, variant, origin });
  const logPath = await writeReplayLog(surface, {
    capabilityPath,
    name: capability.name,
    version: capability.version,
    params,
    variant: variant?.id ?? null,
    result,
  });
  console.log(`status: ${result.status}`);
  if (result.status === "success") console.log(`outputs: ${JSON.stringify(result.outputs)}`);
  if (result.status === "outcome") console.log(`code: ${result.code}`);
  if (result.status === "failed") console.log(`failure: ${JSON.stringify(result.failure)}`);
  if (result.status === "escalated") console.log(`step: ${result.stepId} reason: ${result.reason}`);
  console.log(`url: ${result.evidence.url}`);
  console.log(`evidence: ${logPath}`);
  if (result.status === "failed" || result.status === "escalated") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await surface.close();
}

async function writeReplayLog(
  surface: PlaywrightSurface,
  log: {
    capabilityPath: string;
    name: string;
    version: number;
    params: Record<string, string>;
    variant: string | null;
    result: ReplayResult;
  },
): Promise<string> {
  const tag = log.result.status === "outcome" ? log.result.code : log.result.status;
  const member = log.params.memberId ?? "run";
  const dir = join("evidence", "replay");
  await mkdir(dir, { recursive: true });
  const base = `${log.name}-${member}-${tag}`;
  const screenshot = `${base}.png`;
  await surface.screenshot(join(dir, screenshot));
  const logPath = join(dir, `${base}.json`);
  await writeFile(logPath, `${JSON.stringify({ ...log, screenshot }, null, 2)}\n`);
  return logPath;
}

function readParams(): Record<string, string> {
  if (!process.env.PARAMS) return { memberId: process.env.MEMBER_NUMBER ?? "10003" };
  const parsed: unknown = JSON.parse(process.env.PARAMS);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PARAMS must be a JSON object of strings.");
  }
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") throw new Error(`PARAMS.${key} must be a string.`);
    params[key] = value;
  }
  return params;
}
