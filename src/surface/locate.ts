import type { Frame, Locator, Page } from "playwright";
import type { LocateStrategy, Target } from "./types.ts";

type Role = Parameters<Frame["getByRole"]>[0];

export class LocateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocateError";
  }
}

export type Located = {
  locator: Locator;
  strategy: Exclude<LocateStrategy, "navigate">;
  inFrame: boolean;
};

type Attempt = {
  strategy: Located["strategy"];
  build: (frame: Frame) => Locator;
};

export async function locate(page: Page, target: Target): Promise<Located> {
  const attempts = attemptsFor(target);
  if (attempts.length === 0) {
    throw new LocateError("A target needs a role and name, a landmark path, or nearby text.");
  }

  const tried: string[] = [];
  for (const attempt of attempts) {
    const found = await uniqueMatch(page, attempt.build);
    if (typeof found !== "string") {
      return {
        locator: found.locator,
        strategy: attempt.strategy,
        inFrame: found.frame !== page.mainFrame(),
      };
    }
    tried.push(`${attempt.strategy}: ${found}`);
  }

  throw new LocateError(`Could not find one control. Tried ${tried.join(", ")}.`);
}

function attemptsFor(target: Target): Attempt[] {
  const attempts: Attempt[] = [];
  if (target.role && target.name) {
    const role = target.role;
    const name = target.name;
    attempts.push({
      strategy: "roleName",
      build: (frame) => byRole(frame, role, name),
    });
  }
  if (target.landmarkPath && target.landmarkPath.length > 0) {
    const steps = target.landmarkPath;
    attempts.push({
      strategy: "landmarkPath",
      build: (frame) => chainRoles(frame, steps),
    });
  }
  if (target.nearbyText) {
    const text = target.nearbyText;
    const role = target.role;
    const name = target.name;
    attempts.push({
      strategy: "nearbyText",
      build: (frame) => nearby(frame, text, role, name),
    });
  }
  return attempts;
}

function chainRoles(frame: Frame, steps: NonNullable<Target["landmarkPath"]>): Locator {
  const first = steps[0];
  if (!first) throw new LocateError("Landmark path is empty.");
  let locator = byRole(frame, first.role, first.name);
  for (const step of steps.slice(1)) {
    locator = byRole(locator, step.role, step.name);
  }
  return locator;
}

function nearby(frame: Frame, text: string, role?: string, name?: string): Locator {
  const label = frame.getByText(text, { exact: true });
  if (role) {
    return byRole(label.locator("xpath=ancestor::tr[1]"), role, name);
  }
  return label.locator("xpath=ancestor-or-self::td[1]/following-sibling::td[1]");
}

function byRole(scope: Frame | Locator, role: string, name?: string): Locator {
  return scope.getByRole(role as Role, name ? { name, exact: true } : undefined);
}

async function uniqueMatch(
  page: Page,
  build: (frame: Frame) => Locator,
): Promise<{ locator: Locator; frame: Frame } | "none" | "many"> {
  const hits: { locator: Locator; frame: Frame }[] = [];
  for (const frame of page.frames()) {
    const locator = build(frame);
    const count = await locator.count();
    if (count > 1) return "many";
    if (count === 1) hits.push({ locator, frame });
  }
  const only = hits[0];
  if (hits.length === 1 && only) return only;
  if (hits.length === 0) return "none";
  return "many";
}
