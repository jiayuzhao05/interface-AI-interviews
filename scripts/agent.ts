import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogDocument } from "../src/catalog/catalog.ts";
import { listenCatalog } from "../src/catalog/server.ts";

const origin = process.env.HORIZON_ORIGIN ?? "http://127.0.0.1:4173";
const evidencePath = join(process.cwd(), "evidence", "agent.json");

try {
  const probe = await fetch(`${origin}/members`);
  if (!probe.ok) throw new Error(`Horizon returned ${probe.status}.`);
} catch {
  console.error("The sample app is not running. Start it with npm run horizon.");
  process.exit(1);
}

const catalog = await listenCatalog({ origin });
const baseUrl = `http://127.0.0.1:${catalog.port}`;

try {
  const listed = await getJson<CatalogDocument>(`${baseUrl}/v1/capabilities`);
  const lookup = listed.capabilities.find((item) => item.name === "lookup_savings_balance");
  if (!lookup) throw new Error("lookup_savings_balance is not in the catalog.");
  const variantId = lookup.variants[0]?.id;
  if (!variantId) throw new Error("lookup_savings_balance has no variant in the catalog.");

  const base = await postJson(`${baseUrl}/v1/capabilities/${lookup.name}/invoke`, {
    params: { memberId: "10001" },
  });
  const northline = await postJson(`${baseUrl}/v1/capabilities/${lookup.name}/invoke`, {
    params: { memberId: "10002" },
    variant: variantId,
  });

  const evidence = {
    catalog: listed,
    calls: [
      { name: lookup.name, params: { memberId: "10001" }, variant: null, result: base },
      { name: lookup.name, params: { memberId: "10002" }, variant: variantId, result: northline },
    ],
  };
  await mkdir(join(process.cwd(), "evidence"), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  console.log(`catalog: ${listed.capabilities.map((item) => item.name).join(", ")}`);
  console.log(`base: ${summarize(base)}`);
  console.log(`${variantId}: ${summarize(northline)}`);
  console.log(`evidence: ${evidencePath}`);
  if (base.status !== "success" || northline.status !== "success") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await catalog.close();
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} returned ${response.status}.`);
  return response.json() as Promise<T>;
}

async function postJson(url: string, body: unknown): Promise<{ status: string; outputs?: Record<string, string> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { status?: string; outputs?: Record<string, string>; error?: string };
  if (!response.ok) throw new Error(payload.error ?? `POST ${url} returned ${response.status}.`);
  if (typeof payload.status !== "string") throw new Error("Invoke response has no status.");
  return payload as { status: string; outputs?: Record<string, string> };
}

function summarize(result: { status: string; outputs?: Record<string, string> }): string {
  if (result.status === "success") return `success ${result.outputs?.savingsBalance ?? ""}`.trim();
  return result.status;
}
