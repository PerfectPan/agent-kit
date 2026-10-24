import type { CopyKey } from "./landing-copy.ts";

export interface ProjectChip {
  readonly label: string;
  readonly highlight: boolean;
}

export interface BuiltProject {
  readonly id: "agent-presence" | "agent-task-loop" | "yours";
  readonly href: string;
  readonly title?: CopyKey;
  readonly body: CopyKey;
  readonly yours: boolean;
  readonly chips: readonly ProjectChip[];
}

/** Projects named on the landing page, in the approved mockup's order. */
export const builtProjects: readonly BuiltProject[] = [
  {
    id: "agent-presence",
    href: "https://github.com/PerfectPan/agent-presence",
    body: "presenceBody",
    yours: false,
    chips: [
      { label: "/transcript/usage", highlight: false },
      { label: "/harness/events", highlight: false },
      { label: "/harness", highlight: false },
      { label: "collab/process-lock", highlight: true }
    ]
  },
  {
    id: "agent-task-loop",
    href: "https://github.com/PerfectPan/agent-task-loop",
    body: "loopBody",
    yours: false,
    chips: [
      { label: "/discovery", highlight: false },
      { label: "/sessions", highlight: false },
      { label: "/acp", highlight: false },
      { label: "collab/lease", highlight: true },
      { label: "collab/lanes", highlight: true }
    ]
  },
  {
    id: "yours",
    href: "https://github.com/PerfectPan/agent-kit",
    title: "yoursTitle",
    body: "yoursBody",
    yours: true,
    chips: []
  }
];

export const GITHUB_URL = "https://github.com/PerfectPan/agent-kit";
export const NPM_URL = "https://www.npmjs.com/package/@rivus/agent-kit";
export const CHANGELOG_URL = "https://github.com/PerfectPan/agent-kit/blob/main/packages/agent-kit/CHANGELOG.md";
export const INSTALL_KIT = "npm i @rivus/agent-kit";
export const INSTALL_COLLAB = "npm i @rivus/agent-kit-collab";
