import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { locate } from "./locate.ts";

let browser: Browser;
let page: Page;

const html = `<!DOCTYPE html>
<main aria-label="Servicing">
  <button>Look up</button>
</main>
<button>Look up</button>
<label>Member number <input></label>
<table>
  <tr><td>Savings balance</td><td>$4,280.15</td></tr>
</table>`;

before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent(html);
});

after(async () => {
  await browser.close();
});

test("role and name wins when it matches one control", async () => {
  const found = await locate(page, {
    role: "textbox",
    name: "Member number",
    nearbyText: "Member number",
  });
  assert.equal(found.strategy, "roleName");
});

test("an ambiguous role and name falls through to the landmark path", async () => {
  const found = await locate(page, {
    role: "button",
    name: "Look up",
    landmarkPath: [
      { role: "main", name: "Servicing" },
      { role: "button", name: "Look up" },
    ],
  });
  assert.equal(found.strategy, "landmarkPath");
  assert.equal(await found.locator.innerText(), "Look up");
});

test("nearby text reads the following cell", async () => {
  const found = await locate(page, { nearbyText: "Savings balance" });
  assert.equal(found.strategy, "nearbyText");
  assert.equal((await found.locator.innerText()).trim(), "$4,280.15");
});
