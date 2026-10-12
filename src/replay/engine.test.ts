import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCapability, loadVariant, type VariantOverlay } from "../schema/capability.ts";
import { PlaywrightSurface } from "../surface/playwright-surface.ts";
import { replay, type ReplayResult } from "./engine.ts";

const origin = "http://127.0.0.1:4173";
const capability = loadCapability();
const variant = loadVariant();
let child: ChildProcess | undefined;

describe("replay without a model", { concurrency: false }, () => {
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

  test("found member returns the savings balance", async () => {
    const result = await run({ memberId: "10001" });
    assert.equal(result.status, "success", JSON.stringify(result, null, 2));
    if (result.status !== "success") return;
    assert.equal(result.outputs.savingsBalance, "$4,280.15");
    assert.equal(new URL(result.evidence.url).pathname, "/members/10001");
  });

  test("unknown member is an outcome, not a failure", async () => {
    const result = await run({ memberId: "99999" });
    assert.equal(result.status, "outcome", JSON.stringify(result, null, 2));
    if (result.status !== "outcome") return;
    assert.equal(result.code, "member_not_found");
  });

  test("empty member id is a validation outcome", async () => {
    const result = await run({ memberId: "" });
    assert.equal(result.status, "outcome", JSON.stringify(result, null, 2));
    if (result.status !== "outcome") return;
    assert.equal(result.code, "validation_error");
  });

  test("variant notice is dismissed and the lookup still completes", async () => {
    const result = await run({ memberId: "10002" }, variant);
    assert.equal(result.status, "success", JSON.stringify(result, null, 2));
    if (result.status !== "success") return;
    assert.equal(result.outputs.savingsBalance, "$910.00");
    assert.equal(new URL(result.evidence.url).pathname, "/cu/members/10002");
    assert.equal(
      result.evidence.notes.some((note) => note.detail.includes("Branch notice")),
      true,
    );
  });
});

async function run(params: Record<string, string>, overlay?: VariantOverlay): Promise<ReplayResult> {
  const surface = await PlaywrightSurface.launch({ headless: true });
  try {
    return await replay(surface, { capability, params, variant: overlay, origin });
  } finally {
    await surface.close();
  }
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
