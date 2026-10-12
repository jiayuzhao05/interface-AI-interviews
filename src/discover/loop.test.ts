import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { replay } from "../replay/engine.ts";
import { loadVariant, parseCapability, type Capability, type VariantOverlay } from "../schema/capability.ts";
import { PlaywrightSurface } from "../surface/playwright-surface.ts";
import type { ProposedAction } from "./action.ts";
import { discover } from "./loop.ts";
import { lookupRequest } from "./lookup.ts";
import type { ModelClient } from "./model.ts";

const origin = "http://127.0.0.1:4173";
let child: ChildProcess | undefined;

describe("discovery compiles a replayable capability", { concurrency: false }, () => {
  before(async () => {
    if (await appIsUp()) return;
    child = spawn(process.execPath, ["apps/horizon/server.ts"], {
      cwd: join(dirname(fileURLToPath(import.meta.url)), "../.."),
      stdio: "ignore",
    });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await appIsUp()) return;
      await delay(100);
    }
    throw new Error("Horizon sample app did not start.");
  });

  after(() => {
    child?.kill();
  });

  test("a scripted model can miss, then the compiled file replays", async () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), "discovery-"));
    const surface = await PlaywrightSurface.launch({ headless: true });
    try {
      const result = await discover(surface, scripted(plan()), lookupRequest("10001", origin), evidenceDir);
      assert.equal(result.status, "success", JSON.stringify(result, null, 2));
      if (result.status !== "success") return;

      const capabilityText = readFileSync(join(evidenceDir, "capability.json"), "utf8");
      const trajectoryText = readFileSync(join(evidenceDir, "trajectory.json"), "utf8");
      assert.equal(capabilityText.includes("10001"), false);
      assert.equal(capabilityText.includes("99999"), false);
      assert.equal(trajectoryText.includes('"messages"'), false);
      assert.equal(trajectoryText.includes("You drive a bank servicing screen"), false);
      assert.equal(result.trajectory.steps.some((item) => item.result === "refused" && item.action.includes("Confirm")), true);
      const shots = readdirSync(evidenceDir).filter((name) => name.endsWith(".png"));
      assert.equal(shots.length > 0 && shots.every((name) => statSync(join(evidenceDir, name)).size > 0), true);

      const capability = parseCapability(JSON.parse(capabilityText));
      const found = await replayFresh(capability, { memberId: "10003" });
      assert.equal(found.status, "success", JSON.stringify(found, null, 2));
      if (found.status === "success") assert.equal(found.outputs.savingsBalance, "$15,240.33");

      const missing = await replayFresh(capability, { memberId: "99999" });
      assert.equal(missing.status, "outcome", JSON.stringify(missing, null, 2));
      if (missing.status === "outcome") assert.equal(missing.code, "member_not_found");

      const northline = await replayFresh(capability, { memberId: "10002" }, loadVariant());
      assert.equal(northline.status, "success", JSON.stringify(northline, null, 2));
      if (northline.status === "success") assert.equal(northline.outputs.savingsBalance, "$910.00");
    } finally {
      await surface.close();
    }
  });

  test("step limit stops the run without writing a capability", async () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), "discovery-"));
    const surface = await PlaywrightSurface.launch({ headless: true });
    try {
      const request = lookupRequest("10001", origin);
      request.maxSteps = 1;
      const result = await discover(surface, scripted([{ action: "navigate", path: "/", reason: "open the portal" }]), request, evidenceDir);
      assert.equal(result.status, "exhausted");
      assert.equal(readdirSync(evidenceDir).includes("capability.json"), false);
      assert.equal(readdirSync(evidenceDir).includes("trajectory.json"), true);
    } finally {
      await surface.close();
    }
  });
});

async function replayFresh(capability: Capability, params: Record<string, string>, variant?: VariantOverlay) {
  const surface = await PlaywrightSurface.launch({ headless: true });
  try {
    return await replay(surface, { capability, params, variant, origin });
  } finally {
    await surface.close();
  }
}

function plan(): ProposedAction[] {
  return [
    { action: "navigate", path: "/members", reason: "open member search" },
    { action: "click", role: "button", name: "Confirm", reason: "try the confirm button" },
    { action: "type", role: "textbox", name: "Member number", text: "99999", reason: "try a number" },
    { action: "click", role: "button", name: "Look up", reason: "submit the lookup" },
    { action: "type", role: "textbox", name: "Member number", text: "10001", reason: "enter the member from the goal" },
    { action: "click", role: "button", name: "Look up", reason: "submit the member" },
    { action: "extract", nearbyText: "Savings balance", bind: "savingsBalance", reason: "read the balance beside the label" },
  ];
}

function scripted(actions: ProposedAction[]): ModelClient {
  let index = 0;
  return {
    async nextAction() {
      const action = actions[index];
      index += 1;
      if (!action) throw new Error("Scripted model ran out of actions.");
      return action;
    },
  };
}

async function appIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/members`);
    return response.ok;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
