import { err, ok, type Result } from "@rivus/agent-kit-catalog";
import {
  applyEdits,
  findNodeAtLocation,
  type FormattingOptions,
  modify,
  parse,
  type ParseError,
  parseTree,
  printParseErrorCode
} from "jsonc-parser";

import type { DocumentInvalid } from "../application/ports.js";
import type { EntryEdit } from "./config-entries.js";

/** Parses JSON with comments and trailing commas, as agents' settings files allow; any syntax error refuses the file. */
export function parseJsonc(text: string): Result<unknown, DocumentInvalid> {
  if (text.trim() === "") {
    return ok(undefined);
  }
  const errors: ParseError[] = [];
  const data: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  const [first] = errors;
  return first === undefined
    ? ok(data)
    : err({
        _tag: "DocumentInvalid",
        format: "json",
        detail: `${printParseErrorCode(first.error)} at offset ${first.offset}`
      });
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

/**
 * Applies entry edits to a JSON or JSONC document with jsonc-parser's `modify`, which changes only the edited
 * values: comments, key order and the lines it does not touch stay as they were. jsonc-parser formats the lines an
 * edit touches with the document's indentation, so a one-line value right next to an inserted or removed one can be
 * spread over several lines; an edit inside a one-line container is left unformatted instead. A missing or empty
 * document starts as `{}`.
 */
export function editJsonc(text: string | undefined, edits: readonly EntryEdit[]): string {
  const empty = text === undefined || text.trim() === "";
  let next = empty ? "{}" : text;
  const formattingOptions = formattingOf(empty ? "" : text);
  for (const edit of edits) {
    const formatted = !inlineContainer(next, edit);
    const changes = modify(next, [...edit.path], edit.value, {
      ...(formatted ? { formattingOptions } : {}),
      ...(edit.insert === true ? { isArrayInsertion: true } : {})
    });
    next = applyEdits(next, changes);
  }
  return empty && !next.endsWith("\n") ? `${next}${formattingOptions.eol ?? "\n"}` : next;
}
