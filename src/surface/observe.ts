import type { Frame, Page } from "playwright";
import type { Control, Observation, RoleStep } from "./types.ts";

const structuralRoles = new Set([
  "table",
  "row",
  "rowgroup",
  "generic",
  "presentation",
  "none",
  "text",
  "group",
  "caption",
]);

const interactiveRoles = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "slider",
  "spinbutton",
  "option",
]);

const landmarkRoles = new Set([
  "banner",
  "complementary",
  "contentinfo",
  "form",
  "main",
  "navigation",
  "region",
  "search",
]);

type AriaNode = {
  role?: string;
  name?: string;
  value?: unknown;
  children?: AriaNode[];
};

export async function observePage(page: Page): Promise<Observation> {
  const snapshot: unknown = await page.ariaSnapshotJSON({ mode: "ai" });
  const childFrames = page.frames().filter((frame) => frame !== page.mainFrame());
  const controls: Control[] = [];
  walk(asNodes(snapshot), {
    inFrame: false,
    frameUrl: null,
    landmarks: [],
    frames: childFrames,
    cursor: { index: 0 },
    controls,
  });
  return { url: page.url(), controls };
}

type WalkState = {
  inFrame: boolean;
  frameUrl: string | null;
  landmarks: RoleStep[];
  frames: Frame[];
  cursor: { index: number };
  controls: Control[];
};

function walk(nodes: AriaNode[], state: WalkState): void {
  for (const node of nodes) {
    const role = node.role ?? "";
    const name = node.name ?? "";
    const step: RoleStep = { role, ...(name ? { name } : {}) };
    const child: WalkState =
      role === "iframe"
        ? {
            ...state,
            inFrame: true,
            frameUrl: state.frames[state.cursor.index++]?.url() ?? null,
            landmarks: [],
          }
        : state;

    if (shouldKeep(role, name)) {
      const control: Control = {
        role,
        name,
        inFrame: state.inFrame,
        frameUrl: state.inFrame ? state.frameUrl : null,
      };
      if (typeof node.value === "string" && node.value) control.value = node.value;
      if (state.landmarks.length > 0) control.landmarkPath = [...state.landmarks, step];
      state.controls.push(control);
    }

    if (node.children && node.children.length > 0) {
      const landmarks = role === "iframe" ? [] : landmarkRoles.has(role) ? [...state.landmarks, step] : state.landmarks;
      walk(node.children, { ...child, landmarks });
    }
  }
}

function shouldKeep(role: string, name: string): boolean {
  if (!role || role === "iframe" || structuralRoles.has(role)) return false;
  if (interactiveRoles.has(role) || role === "dialog" || role === "alertdialog") return true;
  return name.length > 0;
}

function asNodes(value: unknown): AriaNode[] {
  if (Array.isArray(value)) return value.filter(isNode);
  if (isNode(value)) return [value];
  return [];
}

function isNode(value: unknown): value is AriaNode {
  return typeof value === "object" && value !== null;
}
