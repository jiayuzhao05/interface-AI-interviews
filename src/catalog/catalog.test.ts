import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CatalogError, catalogDocument, loadCatalog, loadVariantOverlays, parseInvoke } from "./catalog.ts";
import { listenCatalog } from "./server.ts";

const origin = "http://127.0.0.1:4173";
const capabilities = loadCatalog();
const variants = loadVariantOverlays();
let child: ChildProcess | undefined;
let catalog: { port: number; close: () => Promise<void> };

describe("capability catalog", { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) {
      child = spawn(process.execPath, ["apps/horizon/server.ts"], {
        cwd: join(dirname(fileURLToPath(import.meta.url)), "../.."),
        stdio: "ignore",
      });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (await appIsUp()) break;
        await delay(100);
      }
      if (!(await appIsUp())) throw new Error("Horizon sample app did not start.");
    }
    catalog = await listenCatalog({ origin, capabilities, variants });
  });

  after(async () => {
    await catalog.close();
    child?.kill();
  });

  test("the catalog lists names, descriptions, parameters, and return values", async () => {
    const response = await fetch(`http://127.0.0.1:${catalog.port}/v1/capabilities`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as ReturnType<typeof catalogDocument>;
    const lookup = body.capabilities.find((item) => item.name === "lookup_savings_balance");
    assert.ok(lookup);
    assert.match(lookup.description, /savings balance/);
    assert.deepEqual(
      lookup.inputs.map((input) => input.name),
      ["memberId"],
    );
    assert.equal(lookup.inputs[0]?.required, true);
    assert.deepEqual(
      lookup.outputs.map((output) => output.name),
      ["savingsBalance"],
    );
    assert.deepEqual(
      lookup.variants.map((variant) => variant.id),
      ["horizon-variant"],
    );
    assert.equal(
      body.capabilities.some((item) => item.name === "open_sub_account"),
      true,
    );
  });

  test("invoke replays the base app and the variant", async () => {
    const base = await invoke({ params: { memberId: "10001" } });
    assert.equal(base.status, "success", JSON.stringify(base));
    if (base.status === "success") {
      assert.equal(base.outputs.savingsBalance, "$4,280.15");
      assert.equal(new URL(base.evidence.url).pathname, "/members/10001");
    }

    const northline = await invoke({ params: { memberId: "10002" }, variant: "horizon-variant" });
    assert.equal(northline.status, "success", JSON.stringify(northline));
    if (northline.status === "success") {
      assert.equal(northline.outputs.savingsBalance, "$910.00");
      assert.equal(new URL(northline.evidence.url).pathname, "/cu/members/10002");
      assert.equal(
        northline.evidence.notes.some((note) => note.detail.includes("Branch notice")),
        true,
      );
    }
  });

  test("unknown capabilities, variants, and parameters are refused", async () => {
    const missing = await fetch(invokeUrl("missing"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ params: { memberId: "10001" } }),
    });
    assert.equal(missing.status, 404);

    const badVariant = await invokeRaw({ params: { memberId: "10001" }, variant: "other-cu" });
    assert.equal(badVariant.status, 400);

    const badParam = await invokeRaw({ params: {} });
    assert.equal(badParam.status, 400);
  });
});

test("a missing parameter is rejected before replay", () => {
  const lookup = capabilities.find((item) => item.name === "lookup_savings_balance");
  assert.ok(lookup);
  assert.throws(() => parseInvoke(lookup, variants, { params: {} }), CatalogError);
});

async function invoke(body: unknown): Promise<{ status: string; outputs: Record<string, string>; evidence: { url: string; notes: { detail: string }[] } }> {
  const response = await invokeRaw(body);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<{ status: string; outputs: Record<string, string>; evidence: { url: string; notes: { detail: string }[] } }>;
}

function invokeRaw(body: unknown): Promise<Response> {
  return fetch(invokeUrl("lookup_savings_balance"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function invokeUrl(name: string): string {
  return `http://127.0.0.1:${catalog.port}/v1/capabilities/${name}/invoke`;
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
