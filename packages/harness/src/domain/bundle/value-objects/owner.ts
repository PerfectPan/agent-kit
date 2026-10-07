/** The application on whose behalf Artifacts are installed, named like an npm package: `agent-presence`, `@scope/app`. */
export type Owner = string;

export const OWNER_PATTERN: RegExp = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
