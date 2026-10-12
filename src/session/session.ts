import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlaywrightSurface, SessionOwner } from "../surface/playwright-surface.ts";
import type { Control, SurfaceAction } from "../surface/types.ts";

export type InterventionReason = "unknown_dialog" | "irreversible";

export type ControlDiff = {
  urls: string[];
  added: string[];
  removed: string[];
  changed: string[];
};

export type Intervention = {
  id: string;
  capability: string;
  stepId: string;
  reason: InterventionReason;
  screenshot: string;
  owner: SessionOwner;
  status: "waiting" | "resumed";
  before: { url: string; controls: string[] };
  activity?: ControlDiff;
};

export class BrowserSession {
  readonly surface: PlaywrightSurface;
  intervention: Intervention | null = null;
  private ownerState: SessionOwner = "automation";
  private resumed = false;
  private resumeWait: (() => void) | null = null;
  private stopWatch: (() => void) | null = null;
  private urls: string[] = [];
  private beforeControls: Control[] = [];
  private evidenceDir = "";

  constructor(surface: PlaywrightSurface) {
    this.surface = surface;
  }

  get owner(): SessionOwner {
    return this.ownerState;
  }

  async handOff(request: {
    capability: string;
    stepId: string;
    reason: InterventionReason;
    evidenceDir: string;
  }): Promise<Intervention> {
    if (this.ownerState === "human") throw new Error("A person already owns this session.");
    this.resumed = false;
    this.ownerState = "human";
    this.surface.setOwner("human");
    const before = await this.surface.observe();
    this.beforeControls = before.controls;
    this.urls = [before.url];
    this.stopWatch?.();
    this.stopWatch = this.surface.watchNavigation((url) => {
      if (this.urls.at(-1) !== url) this.urls.push(url);
    });
    const id = randomBytes(4).toString("hex");
    await mkdir(request.evidenceDir, { recursive: true });
    const screenshot = await this.surface.screenshot(join(request.evidenceDir, `${id}.png`));
    this.evidenceDir = request.evidenceDir;
    this.intervention = {
      id,
      capability: request.capability,
      stepId: request.stepId,
      reason: request.reason,
      screenshot,
      owner: "human",
      status: "waiting",
      before: { url: before.url, controls: before.controls.map(controlLabel) },
    };
    await this.write();
    return this.intervention;
  }

  async resume(id: string): Promise<Intervention> {
    const current = this.intervention;
    if (!current || current.id !== id) throw new Error(`No intervention ${id}.`);
    if (current.status !== "waiting") throw new Error("Intervention is not waiting.");
    this.stopWatch?.();
    this.stopWatch = null;
    const after = await this.surface.observe();
    if (this.urls.at(-1) !== after.url) this.urls.push(after.url);
    const diff = diffControls(this.beforeControls, after.controls);
    current.activity = { urls: [...this.urls], ...diff };
    current.status = "resumed";
    current.owner = "automation";
    this.ownerState = "automation";
    this.surface.setOwner("automation");
    this.resumed = true;
    await this.write();
    this.resumeWait?.();
    this.resumeWait = null;
    return current;
  }

  waitForResume(): Promise<void> {
    if (this.resumed) return Promise.resolve();
    return new Promise((resolve) => {
      this.resumeWait = resolve;
    });
  }

  /** Test stand-in for a person clicking in the open window. */
  async actAsHuman(action: SurfaceAction): Promise<void> {
    if (this.ownerState !== "human") throw new Error("A person does not own this session.");
    await this.surface.act(action, { asHuman: true });
  }

  private async write(): Promise<void> {
    if (!this.intervention || !this.evidenceDir) return;
    await writeFile(join(this.evidenceDir, `${this.intervention.id}.json`), `${JSON.stringify(this.intervention, null, 2)}\n`);
  }
}

export function diffControls(before: Control[], after: Control[]): Omit<ControlDiff, "urls"> {
  const beforeCounts = count(before);
  const afterCounts = count(after);
  const added: string[] = [];
  const removed: string[] = [];
  for (const [key, afterCount] of afterCounts) {
    const beforeCount = beforeCounts.get(key) ?? 0;
    for (let index = beforeCount; index < afterCount; index += 1) added.push(key);
  }
  for (const [key, beforeCount] of beforeCounts) {
    const afterCount = afterCounts.get(key) ?? 0;
    for (let index = afterCount; index < beforeCount; index += 1) removed.push(key);
  }
  const changed: string[] = [];
  const seen = new Set<string>();
  for (const control of before) {
    const key = controlLabel(control);
    if (seen.has(key) || control.value === undefined) continue;
    seen.add(key);
    const next = after.find((item) => controlLabel(item) === key && item.value !== undefined);
    if (next?.value !== undefined && next.value !== control.value) {
      changed.push(`${key}: "${control.value}" → "${next.value}"`);
    }
  }
  return { added, removed, changed };
}

function count(controls: Control[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const control of controls) {
    const key = controlLabel(control);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function controlLabel(control: Control): string {
  return `${control.role} "${control.name}"`;
}
