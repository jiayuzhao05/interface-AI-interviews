import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadCapability, parseCapability } from "../schema/capability.ts";
import { runSession } from "./run.ts";
import { listenInterventions } from "./server.ts";
import { BrowserSession, type Intervention } from "./session.ts";
import { PlaywrightSurface } from "../surface/playwright-surface.ts";

const origin = "http://127.0.0.1:4173";
const openSubAccount = loadCapability(
  join(dirname(fileURLToPath(import.meta.url)), "../../capabilities/open_sub_account/v1.json"),
);
let child: ChildProcess | undefined;

describe("human handoff keeps the same browser", { concurrency: false }, () => {
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

  test("looking up a balance does not ask for a person", async () => {
    const surface = await PlaywrightSurface.launch({ headless: true });
    const session = new BrowserSession(surface);
    try {
      const run = await runSession(
        session,
        { capability: loadCapability(), params: { memberId: "10001" }, origin },
        { evidenceDir: mkdtempSync(join(tmpdir(), "handoff-")) },
      );
      assert.equal(run.result.status, "success", JSON.stringify(run.result));
      if (run.result.status === "success") assert.equal(run.result.outputs.savingsBalance, "$4,280.15");
      assert.equal(session.owner, "automation");
      assert.equal(run.intervention, null);
    } finally {
      await surface.close();
    }
  });

  test("the sub-account submit waits, then resume continues on the same page", async () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), "handoff-"));
    const surface = await PlaywrightSurface.launch({ headless: true });
    const session = new BrowserSession(surface);
    const api = await listenInterventions(session);
    const pending = runSession(
      session,
      {
        capability: openSubAccount,
        params: { memberId: "10001", product: "Holiday club", nickname: "Rainy day" },
        origin,
      },
      { evidenceDir },
    );
    try {
      const intervention = await waitForWaiting(session);
      assert.equal(session.owner, "human");
      assert.equal(intervention.capability, "open_sub_account");
      assert.equal(intervention.stepId, "submit");
      assert.equal(intervention.reason, "irreversible");
      assert.equal(statSync(intervention.screenshot).size > 0, true);
      assert.match(surface.currentUrl(), /\/sub-account\/confirmation/);
      await assert.rejects(
        () => surface.act({ type: "click", target: { role: "button", name: "Submit" } }),
        /human owns the session/,
      );

      const missing = await fetch(`http://127.0.0.1:${api.port}/v1/interventions/missing/resume`, { method: "POST" });
      assert.equal(missing.status, 404);

      await session.actAsHuman({ type: "click", target: { role: "button", name: "Submit" } });
      const response = await fetch(`http://127.0.0.1:${api.port}/v1/interventions/${intervention.id}/resume`, {
        method: "POST",
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { owner: string; activity: { urls: string[]; removed: string[]; added: string[] } };
      assert.equal(body.owner, "automation");
      assert.equal(session.owner, "automation");
      assert.equal(body.activity.urls.some((url) => url.includes("/sub-account/submitted")), true);
      assert.equal(body.activity.removed.some((item) => item.includes("Submit")), true);
      assert.equal(body.activity.added.some((item) => item.includes("Sub-account submitted")), true);

      const run = await pending;
      assert.equal(run.result.status, "success", JSON.stringify(run.result));
      if (run.result.status === "success") assert.equal(run.result.outputs.submissionStatus, "Sub-account submitted.");
      const card = JSON.parse(readFileSync(join(evidenceDir, `${intervention.id}.json`), "utf8")) as Intervention;
      assert.equal(card.status, "resumed");
      assert.equal(card.owner, "automation");
      assert.equal(card.stepId, "submit");

      const again = await fetch(`http://127.0.0.1:${api.port}/v1/interventions/${intervention.id}/resume`, { method: "POST" });
      assert.equal(again.status, 409);
    } finally {
      if (session.owner === "human" && session.intervention) {
        await session.resume(session.intervention.id).catch(() => undefined);
      }
      await pending.catch(() => undefined);
      await api.close();
      await surface.close();
    }
  });

  test("an unknown dialog hands off the open page", async () => {
    const dialog = await startDialogApp();
    const evidenceDir = mkdtempSync(join(tmpdir(), "handoff-"));
    const surface = await PlaywrightSurface.launch({ headless: true });
    const session = new BrowserSession(surface);
    const api = await listenInterventions(session);
    const capability = parseCapability({
      name: "pass_hold",
      version: 1,
      description: "Pass an unexpected hold and read the result.",
      appId: "hold",
      surface: "web",
      inputs: [{ name: "memberId", type: "string", description: "Unused.", required: true }],
      outputs: [{ name: "result", type: "string", description: "Result text.", pattern: "^done$" }],
      steps: [
        { id: "open-hold", action: "navigate", path: "/hold" },
        { id: "continue", action: "click", target: { role: "button", name: "Look up" } },
        { id: "read-result", action: "extract", target: { nearbyText: "Result" }, bind: "result" },
      ],
      success: { path: "/hold", outputs: ["result"] },
      outcomes: [],
    });
    const pending = runSession(session, { capability, params: { memberId: "10001" }, origin: dialog.origin }, { evidenceDir });
    try {
      const intervention = await waitForWaiting(session);
      assert.equal(intervention.reason, "unknown_dialog");
      assert.equal(intervention.stepId, "open-hold");
      assert.match(surface.currentUrl(), /\/hold$/);
      await session.actAsHuman({ type: "click", target: { role: "link", name: "Dismiss hold" } });
      const response = await fetch(`http://127.0.0.1:${api.port}/v1/interventions/${intervention.id}/resume`, {
        method: "POST",
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { activity: { urls: string[]; removed: string[] } };
      assert.equal(body.activity.urls.some((url) => url.includes("clear=1")), true);
      assert.equal(body.activity.removed.some((item) => item.includes("Unexpected hold")), true);
      const run = await pending;
      assert.equal(run.result.status, "success", JSON.stringify(run.result));
      if (run.result.status === "success") assert.equal(run.result.outputs.result, "done");
      assert.equal(surface.currentUrl().includes("/hold"), true);
    } finally {
      if (session.owner === "human" && session.intervention) {
        await session.resume(session.intervention.id).catch(() => undefined);
      }
      await pending.catch(() => undefined);
      await api.close();
      await surface.close();
      dialog.close();
    }
  });
});

async function waitForWaiting(session: BrowserSession): Promise<Intervention> {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    if (session.intervention?.status === "waiting") return session.intervention;
    await delay(50);
  }
  throw new Error("Timed out waiting for a human handoff.");
}

function startDialogApp(): Promise<{ origin: string; close: () => void }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const clear = url.searchParams.get("clear") === "1";
    const dialog = clear
      ? ""
      : `<div role="dialog" aria-label="Unexpected hold"><a href="/hold?clear=1">Dismiss hold</a></div>`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html><body>
      ${dialog}
      <button>Look up</button>
      <table><tr><td>Result</td><td>done</td></tr></table>
    </body></html>`);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
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
