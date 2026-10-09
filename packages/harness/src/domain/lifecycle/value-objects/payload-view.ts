import type { FieldPath } from "./hook-dialect.js";

/**
 * One hook payload, as a hook dialect reads it: each of the dialect's declared paths holds the string the payload
 * carries there, or nothing when the path is absent or holds another type. The adapter that translates a payload
 * builds this view once; policies and services read it instead of the raw payload.
 */
export interface PayloadView {
  get(path: FieldPath): string | undefined;
}
