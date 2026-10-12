import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { PolicyDenied } from "../policy/policy.ts";
import { PlaywrightSurface } from "./playwright-surface.ts";

let server: Server;
let origin = "";
let surface: PlaywrightSurface;

const html = `<!DOCTYPE html>
<button onclick="this.textContent='clicked'">Confirm</button>
<button onclick="this.textContent='looked up'">Look up</button>`;

before(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  origin = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}/`);
    });
  });
  surface = await PlaywrightSurface.launch({ headless: true });
});

after(async () => {
  await surface.close();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("allowlist blocks other hosts and irreversible buttons, then allows a normal click", async () => {
  await assert.rejects(() => surface.act({ type: "navigate", url: "https://example.com/members" }), PolicyDenied);
  assert.equal(surface.currentUrl(), "about:blank");

  await surface.act({ type: "navigate", url: origin });
  await assert.rejects(
    () => surface.act({ type: "click", target: { role: "button", name: "Confirm" } }),
    PolicyDenied,
  );
  assert.equal(await namedButton(surface, "Confirm"), "Confirm");

  await surface.act({ type: "click", target: { role: "button", name: "Confirm" } }, { allowIrreversible: true });
  assert.equal(await namedButton(surface, "clicked"), "clicked");

  const clicked = await surface.act({ type: "click", target: { role: "button", name: "Look up" } });
  assert.equal(clicked.strategy, "roleName");
  assert.equal(await namedButton(surface, "looked up"), "looked up");
});

async function namedButton(current: PlaywrightSurface, name: string): Promise<string | undefined> {
  const seen = await current.observe();
  return seen.controls.find((control) => control.role === "button" && control.name === name)?.name;
}
