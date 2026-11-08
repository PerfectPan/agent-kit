import { err, ok, type Result } from "@rivus/agent-kit-catalog/public";
import {
  applyEdits,
  type Edit,
  findNodeAtLocation,
  type FormattingOptions,
  modify,
  parse,
  type ParseError,
  parseTree,
  printParseErrorCode
} from "jsonc-parser";

import type { DocumentInvalid } from "../../application/ports.js";
import type { Document } from "../services/document.js";
import { parseDocument } from "../services/document.js";
import type { EntryEdit } from "../services/config-entries.js";

/** Parses JSON with comments and trailing commas, as agents' settings files allow; any syntax error refuses the file. */
export function parseJsonc(text: string): Result<Document | undefined, DocumentInvalid> {
  if (text.trim() === "") {
    return ok(undefined);
  }
  const errors: ParseError[] = [];
  const data: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  const [first] = errors;
  if (first !== undefined) {
    return err({
      _tag: "DocumentInvalid",
      format: "json",
      detail: `${printParseErrorCode(first.error)} at offset ${first.offset}`
    });
  }
  const document = parseDocument(data);
  return document === undefined && data !== undefined
    ? err({ _tag: "DocumentInvalid", format: "json", detail: "the document holds a value JSON does not define" })
    : ok(document);
}

/** The indentation and line ending the document already uses, so that inserted lines look like their neighbours. */
function formattingOf(text: string): FormattingOptions {
  const indent = /^([ \t]+)\S/m.exec(text)?.[1];
  return {
    insertSpaces: indent?.startsWith("\t") !== true,
    tabSize: indent === undefined || indent.startsWith("\t") ? 2 : indent.length,
    eol: text.includes("\r\n") ? "\r\n" : "\n"
  };
}

/**
 * Whether the edit lands in a container written on one line, such as `"Stop": [{ … }]`. jsonc-parser formats the
 * whole lines an insertion touches, which would spread such a container over many lines; inserting there without
 * formatting keeps the user's layout, and removing the inserted value later restores it byte for byte.
 */
function inlineContainer(text: string, edit: EntryEdit): boolean {
  const tree = parseTree(text);
  const container = tree === undefined ? undefined : findNodeAtLocation(tree, edit.path.slice(0, -1));
  return container !== undefined && !text.slice(container.offset, container.offset + container.length).includes("\n");
}

function removeLastInlineArrayElement(text: string, edit: EntryEdit): Edit[] | undefined {
  const index = edit.path.at(-1);
  if (edit.value !== undefined || typeof index !== "number" || index < 1) {
    return undefined;
  }
  const tree = parseTree(text);
  const parent = tree === undefined ? undefined : findNodeAtLocation(tree, edit.path.slice(0, -1));
  if (parent?.type !== "array") {
    return undefined;
  }
  const children = parent.children ?? [];
  const previous = children[index - 1];
  const removed = children[index];
  if (index !== children.length - 1 || previous === undefined || removed === undefined) {
    return undefined;
  }
  const offset = previous.offset + previous.length;
  // For a single-line array, jsonc-parser's last-item range can leave part of the value behind. Parsed node spans
  // remove the preceding comma and whole value; multiline deletions retain the parser's comment and formatting rules.
  return [{ offset, length: removed.offset + removed.length - offset, content: "" }];
}

/**
 * Applies entry edits to a JSON or JSONC document with jsonc-parser's `modify`, which changes only the edited
 * values: comments, key order and the lines it does not touch stay as they were. jsonc-parser formats the lines an
 * edit touches with the document's indentation, so a one-line value right next to an inserted or removed one can be
 * spread over several lines; an edit inside a one-line container is left unformatted instead, and a last array
 * element there is removed by its parsed span. Multiline edits keep the parser's behavior. A missing or empty
 * document starts as `{}`.
 */
export function editJsonc(text: string | undefined, edits: readonly EntryEdit[]): string {
  const empty = text === undefined || text.trim() === "";
  let next = empty ? "{}" : text;
  const formattingOptions = formattingOf(empty ? "" : text);
  for (const edit of edits) {
    const formatted = !inlineContainer(next, edit);
    const changes =
      (formatted ? undefined : removeLastInlineArrayElement(next, edit)) ??
      modify(next, [...edit.path], edit.value, {
        ...(formatted ? { formattingOptions } : {}),
        ...(edit.insert === true ? { isArrayInsertion: true } : {})
      });
    next = applyEdits(next, changes);
  }
  return empty && !next.endsWith("\n") ? `${next}${formattingOptions.eol ?? "\n"}` : next;
}
