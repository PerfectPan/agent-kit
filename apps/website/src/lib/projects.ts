import type { CopyKey } from "./landing-copy.ts";

export interface BuiltProject {
  readonly id: "agent-presence" | "agent-task-loop";
  readonly href: string;
  readonly body: CopyKey;
  readonly github: CopyKey;
}

/** Projects named on the landing page. */
export const builtProjects: readonly BuiltProject[] = [
  {
    id: "agent-presence",
    href: "https://github.com/PerfectPan/agent-presence",
    body: "presenceBody",
    github: "presenceGithub"
  },
  {
    id: "agent-task-loop",
    href: "https://github.com/PerfectPan/agent-task-loop",
    body: "loopBody",
    github: "loopGithub"
  }
];

export const GITHUB_URL = "https://github.com/PerfectPan/agent-kit";
export const NPM_URL = "https://www.npmjs.com/package/@rivus/agent-kit";
export const CHANGELOG_URL = "https://github.com/PerfectPan/agent-kit/blob/main/packages/agent-kit/CHANGELOG.md";
export const INSTALL_KIT = "npm i @rivus/agent-kit";
export const INSTALL_COLLAB = "npm i @rivus/agent-kit-collab";
