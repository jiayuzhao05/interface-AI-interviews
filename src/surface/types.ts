export type RoleStep = {
  role: string;
  name?: string;
};

/** How to find a control. Strategies are tried in the order role+name, landmark path, nearby text. */
export type Target = {
  role?: string;
  name?: string;
  landmarkPath?: RoleStep[];
  nearbyText?: string;
};

export type Control = {
  role: string;
  name: string;
  inFrame: boolean;
  frameUrl: string | null;
  value?: string;
  landmarkPath?: RoleStep[];
};

export type Observation = {
  url: string;
  controls: Control[];
};

export type SurfaceAction =
  | { type: "navigate"; url: string }
  | { type: "click"; target: Target }
  | { type: "type"; target: Target; text: string }
  | { type: "extract"; target: Target };

export type LocateStrategy = "roleName" | "landmarkPath" | "nearbyText" | "navigate";

export type ActResult = {
  strategy: LocateStrategy;
  text?: string;
};

export type ActOptions = {
  /** Clicks a Confirm, Submit, Transfer, or Delete button only when this is set. */
  allowIrreversible?: boolean;
  /** A person using the live window. Automation calls leave this unset. */
  asHuman?: boolean;
};
