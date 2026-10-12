import { PlaywrightSurface } from "../src/surface/playwright-surface.ts";

const url = process.env.HORIZON_URL ?? "http://127.0.0.1:4173/members";
const memberNumber = process.env.MEMBER_NUMBER ?? "10001";
const surface = await PlaywrightSurface.launch({ headless: process.env.HEADED !== "1" });

try {
  await surface.act({ type: "navigate", url });
  const typed = await surface.act({
    type: "type",
    target: { role: "textbox", name: "Member number" },
    text: memberNumber,
  });
  const clicked = await surface.act({
    type: "click",
    target: { role: "button", name: "Look up" },
  });
  const seen = await surface.observe();
  const extracted = await surface.act({
    type: "extract",
    target: { nearbyText: "Savings balance" },
  });
  const balance = seen.controls.find((control) => control.name === extracted.text);
  const screenshot = await surface.screenshot("evidence/step2-lookup.png");

  console.log(`url: ${seen.url}`);
  console.log(`savings balance: ${extracted.text}`);
  console.log(`balance in iframe: ${balance?.inFrame === true}`);
  console.log(`strategies: type=${typed.strategy} click=${clicked.strategy} extract=${extracted.strategy}`);
  console.log(`screenshot: ${screenshot}`);

  if (extracted.text !== "$4,280.15" || balance?.inFrame !== true) process.exitCode = 1;
  if (typed.strategy !== "roleName" || clicked.strategy !== "roleName" || extracted.strategy !== "nearbyText") {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ERR_CONNECTION_REFUSED")) {
    console.error("The sample app is not running. Start it with npm run horizon.");
  } else {
    console.error(message);
  }
  process.exitCode = 1;
} finally {
  await surface.close();
}
