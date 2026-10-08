import { err, ok, type Result } from "@rivus/agent-kit-catalog";
import { parse, patch, TomlDocument } from "@decimalturn/toml-patch";

import type { DocumentInvalid, UnexpectedShape } from "../../application/ports.js";
import type { EntryEdit, EntryPath } from "../services/config-entries.js";

export function parseToml(text: string): Result<unknown, DocumentInvalid> {
  try {
    return ok(parse(text) as unknown);
  } catch (cause) {
    return err({
      _tag: "DocumentInvalid",
      format: "toml",
      detail: cause instanceof Error ? cause.message : String(cause)
    });
  }
}

/**
 * `data` with one edit applied, copying only the containers on the edit's path, so that every other value (TOML
 * dates included) stays the very object the parser returned and `patch` sees it unchanged.
 */
function applyEdit(data: unknown, path: EntryPath, edit: EntryEdit): unknown {
  const [key, ...rest] = path;
  if (key === undefined) {
    return edit.value;
  }
  if (typeof key === "number") {
    const list = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (rest.length > 0) {
      list[key] = applyEdit(list[key], rest, edit);
    } else if (edit.value === undefined) {
      list.splice(key, 1);
    } else if (edit.insert === true) {
      list.splice(key, 0, edit.value);
    } else {
      list[key] = edit.value;
    }
    return list;
  }
  const object: Record<string, unknown> =
    typeof data === "object" && data !== null && !Array.isArray(data) ? { ...(data as Record<string, unknown>) } : {};
  if (rest.length > 0) {
    object[key] = applyEdit(object[key], rest, edit);
  } else if (edit.value === undefined) {
    delete object[key];
  } else {
    object[key] = edit.value;
  }
  return object;
}

/** The parts of toml-patch's syntax tree that removals read: 1-based lines, 0-based columns. */
interface Position {
  readonly line: number;
  readonly column: number;
}

interface TomlNode {
  readonly type: string;
  readonly loc: { readonly start: Position; readonly end: Position };
  readonly key?: { readonly value?: readonly string[]; readonly item?: { readonly value: readonly string[] } };
  readonly items?: readonly TomlNode[];
  readonly value?: TomlNode;
  readonly item?: TomlNode;
}

type Range = readonly [number, number];

/** Where one table's values are written: its own key-values and the table headers below it. */
interface Scope {
  readonly prefix: readonly string[];
  readonly items: readonly TomlNode[];
  readonly blocks: readonly TomlNode[];
}

const keyOf = (node: TomlNode): readonly string[] => node.key?.item?.value ?? node.key?.value ?? [];
const isHeader = (node: TomlNode) => node.type === "Table" || node.type === "TableArray";
const startsWith = (key: readonly string[], prefix: readonly (string | number)[]) =>
  key.length >= prefix.length && prefix.every((part, index) => key[index] === part);
const sameKey = (a: readonly string[], b: readonly (string | number)[]) => a.length === b.length && startsWith(a, b);

/**
 * The text ranges that hold the value at `path`. Removals delete them exactly instead of letting `patch` diff array
 * tables: toml-patch 3.3 drops the remaining elements' `[[…hooks]]` subtables when one element of an array table goes.
 * A key-value goes with its line, a table with its lines up to its last key-value (comments after that may introduce
 * the next table), an inline element with its separating comma. `undefined` when the value is not written in a layout
 * this reads.
 */
function removalRanges(text: string, cst: readonly TomlNode[], path: EntryPath): Range[] | undefined {
  const lineStarts = [0];
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    lineStarts.push(index + 1);
  }
  const at = (position: Position) => (lineStarts[position.line - 1] ?? text.length) + position.column;
  const lineStart = (offset: number) => text.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = (offset: number) => {
    const newline = text.indexOf("\n", offset);
    return newline === -1 ? text.length : newline + 1;
  };
  const lineRange = (node: TomlNode): Range => [lineStart(at(node.loc.start)), lineEnd(at(node.loc.end))];

  /** Tables that follow each other directly, as one range with the blank lines between them. */
  const blocksRange = (blocks: readonly TomlNode[]): Range[] => {
    const ranges: Range[] = [];
    for (const block of blocks) {
      const last = (block.items ?? []).findLast((item) => item.type !== "Comment") ?? block;
      const range: Range = [lineStart(at(block.loc.start)), lineEnd(at(last.loc.end))];
      const previous = ranges.at(-1);
      const before = cst[cst.indexOf(block) - 1];
      if (previous !== undefined && before !== undefined && blocks.includes(before)) {
        ranges[ranges.length - 1] = [previous[0], range[1]];
      } else {
        ranges.push(range);
      }
    }
    return ranges;
  };

  const inline = (node: TomlNode | undefined, rest: EntryPath): Range[] | undefined => {
    const [head, ...more] = rest;
    const items = node?.items ?? [];
    let index = -1;
    if (node?.type === "InlineArray" && typeof head === "number") {
      index = head;
    } else if (node?.type === "InlineTable" && typeof head === "string") {
      index = items.findIndex((item) => item.item !== undefined && sameKey(keyOf(item.item), [head]));
    }
    const item = items[index];
    if (item === undefined) {
      return undefined;
    }
    if (more.length > 0) {
      return inline(node?.type === "InlineTable" ? item.item?.value : item.item, more);
    }
    const next = items[index + 1];
    const previous = items[index - 1];
    if (next !== undefined) {
      return [[at(item.loc.start), at(next.loc.start)]];
    }
    return [[previous === undefined ? at(item.loc.start) : at(previous.loc.end), at(item.loc.end)]];
  };

  const resolve = (scope: Scope, rest: EntryPath): Range[] | undefined => {
    const [head, ...more] = rest;
    if (typeof head !== "string") {
      return undefined;
    }
    const keyValues = scope.items.filter((item) => item.type === "KeyValue" && keyOf(item)[0] === head);
    for (const keyValue of keyValues) {
      const key = keyOf(keyValue);
      if (key.length <= rest.length && sameKey(key, rest.slice(0, key.length))) {
        return key.length === rest.length ? [lineRange(keyValue)] : inline(keyValue.value, rest.slice(key.length));
      }
    }
    const base = [...scope.prefix, head];
    const under = scope.blocks.filter((block) => startsWith(keyOf(block), base));
    if (more.length === 0) {
      // Dotted keys such as `hooks.Stop = …` below the value go with it.
      const dotted = keyValues.filter((item) => startsWith(keyOf(item), rest));
      const ranges = [...dotted.map(lineRange), ...blocksRange(under)];
      return ranges.length === 0 ? undefined : ranges;
    }
    const [next, ...deeper] = more;
    if (typeof next === "number") {
      // An array table: each `[[base]]` header starts an element, followed by the tables below that element.
      const elements: TomlNode[][] = [];
      for (const block of under) {
        if (block.type === "TableArray" && sameKey(keyOf(block), base)) {
          elements.push([block]);
        } else if (keyOf(block).length > base.length) {
          elements.at(-1)?.push(block);
        }
      }
      const [header, ...below] = elements[next] ?? [];
      if (header === undefined) {
        return undefined;
      }
      return deeper.length === 0
        ? blocksRange([header, ...below])
        : resolve({ prefix: base, items: header.items ?? [], blocks: below }, deeper);
    }
    const table = under.find((block) => block.type === "Table" && sameKey(keyOf(block), base));
    return resolve(
      { prefix: base, items: table?.items ?? [], blocks: under.filter((block) => keyOf(block).length > base.length) },
      more
    );
  };

  return resolve({ prefix: [], items: cst.filter((node) => !isHeader(node)), blocks: cst.filter(isHeader) }, path);
}

/**
 * Deletes the ranges, each with the blank line before it (or, at the start of the document, after it), so that
 * removing a table `patch` appended restores the text as it was.
 */
function deleteRanges(text: string, ranges: readonly Range[]): string {
  let next = text;
  for (const [start, end] of ranges.toSorted((a, b) => b[0] - a[0])) {
    const blankBefore = start >= 2 && next.slice(start - 2, start) === "\n\n";
    const blankAfter = start === 0 && next[end] === "\n";
    next = next.slice(0, blankBefore ? start - 1 : start) + next.slice(blankAfter ? end + 1 : end);
  }
  return next;
}

/** JSON with sorted keys, to compare what a TOML text holds (dates as ISO text) with what the edits should give. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === "object" && inner !== null && !Array.isArray(inner) && !(inner instanceof Date)
      ? Object.fromEntries(Object.entries(inner).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner
  );
}

/**
 * Applies entry edits to a TOML document, keeping comments, whitespace and the layout of untouched tables. An
 * addition goes through `@decimalturn/toml-patch`'s `patch`, which writes new values inline or appends array tables;
 * a removal deletes exact text ranges (see `removalRanges`). The result is parsed again and must hold exactly the data
 * the edits describe, so a layout the editor cannot handle is refused with `UnexpectedShape` instead of written
 * damaged.
 */
export function editToml(
  text: string | undefined,
  data: unknown,
  edits: readonly EntryEdit[]
): Result<string, UnexpectedShape> {
  const refused = (detail: string) => err<UnexpectedShape>({ _tag: "UnexpectedShape", detail });
  let current = text ?? "";
  let expected: unknown = data ?? {};
  for (const edit of edits) {
    expected = applyEdit(expected, edit.path, edit);
    if (edit.value !== undefined) {
      current = patch(current, expected);
      continue;
    }
    const cst = new TomlDocument(current).cst as unknown as readonly TomlNode[];
    const ranges = removalRanges(current, cst, edit.path);
    if (ranges === undefined) {
      return refused(`/${edit.path.join("/")} is written in a TOML layout harness does not edit`);
    }
    current = deleteRanges(current, ranges);
  }
  const result = parseToml(current);
  return result.ok && canonical(result.value) === canonical(expected)
    ? ok(current)
    : refused("the edited TOML would not hold the expected data, so the file is left as it is");
}
