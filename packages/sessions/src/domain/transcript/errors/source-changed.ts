import type { SourcePointer } from "../value-objects/source-pointer.js";

/** The bytes at a source pointer are no longer the record, because the file changed after it was read. */
export interface SourceChanged {
  readonly _tag: "SourceChanged";
  readonly source: SourcePointer;
}
