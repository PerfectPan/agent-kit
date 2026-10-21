import { dirname } from "node:path";

export interface Case {
  readonly name: string;
  /** Package folder under `packages/`. */
  readonly pkg: string;
  /** Package-relative path. A file that exists gets the source appended. */
  readonly path: string;
  readonly source: string;
  readonly expected: readonly string[];
}

let counter = 0;
/** A new file in the directory of `path`, so that the case keeps its layer without touching real files. */
export const fresh = (path: string, extension = "ts"): string => `${dirname(path)}/case-${(counter += 1)}.${extension}`;
export const allowed = (name: string, pkg: string, path: string, source: string): Case => ({
  name,
  pkg,
  path,
  source,
  expected: []
});
export const rejects = (name: string, pkg: string, path: string, source: string, rule: string): Case => ({
  name,
  pkg,
  path,
  source,
  expected: [rule]
});
