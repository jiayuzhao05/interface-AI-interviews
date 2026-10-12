import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { discover } from "../src/discover/loop.ts";
import { lookupRequest } from "../src/discover/lookup.ts";
import { createModelClient } from "../src/discover/model.ts";
import { PlaywrightSurface } from "../src/surface/playwright-surface.ts";

const origin = process.env.HORIZON_ORIGIN ?? "http://127.0.0.1:4173";
const memberId = process.env.MEMBER_NUMBER ?? "10001";
const id = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const evidenceDir = join("evidence", `discovery-${id}`);

let model;
try {
  model = createModelClient();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

try {
  const probe = await fetch(`${origin}/members`);
  if (!probe.ok) throw new Error(`Horizon returned ${probe.status}.`);
} catch {
  console.error("The sample app is not running. Start it with npm run horizon.");
  process.exit(1);
}

const surface = await PlaywrightSurface.launch({ headless: process.env.HEADED !== "1" });
try {
  const result = await discover(surface, model, lookupRequest(memberId, origin), evidenceDir);
  console.log(`evidence: ${evidenceDir}`);
  console.log(`discovery: ${result.status}`);
  if (result.status !== "success") {
    process.exitCode = 1;
  } else {
    const latest = join("evidence", "latest");
    await mkdir(latest, { recursive: true });
    await copyFile(join(evidenceDir, "capability.json"), join(latest, "capability.json"));
    console.log("npm run replay -- evidence/latest/capability.json");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await surface.close();
}
