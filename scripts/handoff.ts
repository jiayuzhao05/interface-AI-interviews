import { join } from "node:path";
import { loadCapability } from "../src/schema/capability.ts";
import { listenInterventions } from "../src/session/server.ts";
import { runSession } from "../src/session/run.ts";
import { BrowserSession } from "../src/session/session.ts";
import { PlaywrightSurface } from "../src/surface/playwright-surface.ts";

const origin = process.env.HORIZON_ORIGIN ?? "http://127.0.0.1:4173";
const memberId = process.env.MEMBER_NUMBER ?? "10001";
const port = Number(process.env.INTERVENTION_PORT ?? 4180);
const capability = loadCapability(join(process.cwd(), "capabilities/open_sub_account/v1.json"));
const evidenceDir = join(process.cwd(), "evidence", "interventions");

try {
  const probe = await fetch(`${origin}/members`);
  if (!probe.ok) throw new Error(`Horizon returned ${probe.status}.`);
} catch {
  console.error("The sample app is not running. Start it with npm run horizon.");
  process.exit(1);
}

const surface = await PlaywrightSurface.launch({ headless: process.env.HEADLESS === "1" });
const session = new BrowserSession(surface);
const api = await listenInterventions(session, port);

try {
  console.log(`owner: ${session.owner}`);
  console.log("Opening the sub-account confirmation. Submit stays with you.");
  const run = await runSession(
    session,
    {
      capability,
      params: { memberId, product: "Holiday club", nickname: "Rainy day" },
      origin,
    },
    {
      evidenceDir,
      onHandoff(intervention) {
        console.log(`owner: ${session.owner}`);
        console.log(`intervention: ${intervention.id}`);
        console.log(`capability: ${intervention.capability}`);
        console.log(`step: ${intervention.stepId}`);
        console.log(`reason: ${intervention.reason}`);
        console.log(`screenshot: ${intervention.screenshot}`);
        console.log(`The browser stays open. Submit the sub-account in that window, then run:`);
        console.log(`curl -X POST http://127.0.0.1:${api.port}/v1/interventions/${intervention.id}/resume`);
      },
    },
  );
  console.log(`owner: ${session.owner}`);
  console.log(`replay: ${run.result.status}`);
  if (run.result.status === "success") console.log(`status: ${run.result.outputs.submissionStatus}`);
  if (run.intervention?.activity) console.log(`activity: ${JSON.stringify(run.intervention.activity)}`);
  if (run.result.status !== "success") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await api.close();
  await surface.close();
}
