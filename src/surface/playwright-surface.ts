import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Browser, type Frame, type Locator, type Page } from "playwright";
import {
  assertActionAllowed,
  assertHostAllowed,
  isIrreversibleName,
  loadPolicy,
  PolicyDenied,
  type PolicyConfig,
} from "../policy/policy.ts";
import { locate } from "./locate.ts";
import { observePage } from "./observe.ts";
import type { ActOptions, ActResult, Observation, SurfaceAction } from "./types.ts";

export type SessionOwner = "automation" | "human";

export class PlaywrightSurface {
  private readonly browser: Browser;
  private readonly page: Page;
  private readonly policy: PolicyConfig;
  private owner: SessionOwner = "automation";

  private constructor(browser: Browser, page: Page, policy: PolicyConfig) {
    this.browser = browser;
    this.page = page;
    this.policy = policy;
  }

  static async launch(options?: { headless?: boolean; policy?: PolicyConfig }): Promise<PlaywrightSurface> {
    const browser = await chromium.launch({ headless: options?.headless ?? true });
    const page = await browser.newPage();
    page.setDefaultTimeout(15_000);
    return new PlaywrightSurface(browser, page, options?.policy ?? loadPolicy());
  }

  currentUrl(): string {
    return this.page.url();
  }

  setOwner(owner: SessionOwner): void {
    this.owner = owner;
  }

  /** Records main-frame navigations. Used while a person owns the session. */
  watchNavigation(listener: (url: string) => void): () => void {
    const handler = (frame: Frame) => {
      if (frame === this.page.mainFrame()) listener(frame.url());
    };
    this.page.on("framenavigated", handler);
    return () => {
      this.page.off("framenavigated", handler);
    };
  }

  async observe(): Promise<Observation> {
    return observePage(this.page);
  }

  async act(action: SurfaceAction, options?: ActOptions): Promise<ActResult> {
    if (this.owner === "human" && !options?.asHuman) {
      throw new PolicyDenied("Refused to act while a human owns the session.");
    }
    assertActionAllowed(this.policy, action.type);
    if (action.type === "navigate") {
      assertHostAllowed(this.policy, action.url);
      await this.page.goto(action.url, { waitUntil: "domcontentloaded" });
      return { strategy: "navigate" };
    }

    assertHostAllowed(this.policy, this.page.url());
    const found = await locate(this.page, action.target);
    if (action.type === "click") {
      await this.refuseIrreversible(found.locator, options?.asHuman ? { ...options, allowIrreversible: true } : options);
      await found.locator.click();
      await waitForChildFrames(this.page);
      return { strategy: found.strategy };
    }
    if (action.type === "type") {
      const tagName = await found.locator.evaluate((element) => element.tagName);
      if (tagName === "SELECT") await found.locator.selectOption({ label: action.text });
      else await found.locator.fill(action.text);
      return { strategy: found.strategy };
    }
    const text = (await found.locator.innerText()).replace(/\s+/g, " ").trim();
    return { strategy: found.strategy, text };
  }

  /** Writes a screenshot to disk. Callers decide from the accessibility tree, not from this image. */
  async screenshot(filePath: string): Promise<string> {
    await mkdir(dirname(filePath), { recursive: true });
    await this.page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  private async refuseIrreversible(locator: Locator, options?: ActOptions): Promise<void> {
    const name = await buttonName(locator);
    if (!name || !isIrreversibleName(this.policy, name) || options?.allowIrreversible) return;
    throw new PolicyDenied(`Refused to click irreversible control "${name}".`);
  }
}

async function buttonName(locator: Locator): Promise<string | null> {
  return locator.evaluate((element) => {
    const tag = element.tagName;
    const role = element.getAttribute("role");
    const inputType = element.getAttribute("type") ?? "";
    const isButton =
      tag === "BUTTON" || role === "button" || (tag === "INPUT" && (inputType === "submit" || inputType === "button"));
    if (!isButton) return null;
    return element.getAttribute("aria-label") || element.textContent || "";
  });
}

async function waitForChildFrames(page: Page): Promise<void> {
  const frames = page.locator("iframe");
  const count = await frames.count();
  for (let index = 0; index < count; index += 1) {
    const handle = await frames.nth(index).elementHandle();
    const frame = await handle?.contentFrame();
    if (frame) await frame.waitForLoadState("domcontentloaded");
  }
}
