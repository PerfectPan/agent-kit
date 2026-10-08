import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import type { UnexpectedShape } from "../../application/ports.js";
import type { ArtifactLocator } from "../../domain/install-plan/index.js";
import type { JsonValue } from "../../domain/ledger/index.js";

/** A key of an object or an index of an array, from the document root. */
export type EntryPath = readonly (string | number)[];

/**
 * One change to a configuration document: set `value` at `path`, insert it at the array index `path` names, or
 * remove what is at `path` when `value` is undefined. Editors apply the edits in order.
 */
export interface EntryEdit {
  readonly path: EntryPath;
  readonly value: JsonValue | undefined;
  readonly insert?: true;
}

type Container = { readonly [key: string]: unknown } | readonly unknown[];

const isObject = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The keys of a JSON pointer such as `/hooks/Stop`, unescaped (`~1` is `/`, `~0` is `~`). */
export function pointerKeys(pointer: string): readonly string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function child(container: unknown, key: string | number): unknown {
  if (typeof key === "number") {
    return Array.isArray(container) ? container[key] : undefined;
  }
  return isObject(container) && Object.hasOwn(container, key) ? container[key] : undefined;
}

function at(data: unknown, path: EntryPath): unknown {
  return path.reduce<unknown>((value, key) => child(value, key), data);
}

/** An element's identity: a string element is its own identity, an object one its `command`, else its `name`. */
function identity(element: unknown): string | undefined {
  if (typeof element === "string") {
    return element;
  }
  if (!isObject(element)) {
    return undefined;
  }
  const { command, name } = element;
  return typeof command === "string" ? command : typeof name === "string" ? name : undefined;
}

interface Found {
  readonly path: EntryPath;
  readonly value: unknown;
}

/** Where the locator's entry is in `data`, or `undefined` when it is not there. */
function find(data: unknown, locator: ArtifactLocator): Result<Found | undefined, UnexpectedShape> {
  const base = pointerKeys(locator.pointer ?? "");
  const list = at(data, base);
  if (locator.member === undefined) {
    return ok(list === undefined ? undefined : { path: base, value: list });
  }
  if (list === undefined) {
    return ok(undefined);
  }
  if (!Array.isArray(list)) {
    return err({ _tag: "UnexpectedShape", detail: `${locator.pointer} is not a list` });
  }
  if (locator.memberIn !== "hook-group") {
    const index = list.findIndex((element) => identity(element) === locator.member);
    return ok(index < 0 ? undefined : { path: [...base, index], value: list[index] });
  }
  for (const [group, entry] of list.entries()) {
    const hooks = isObject(entry) ? entry.hooks : undefined;
    if (!Array.isArray(hooks)) {
      continue;
    }
    const index = hooks.findIndex((hook) => identity(hook) === locator.member);
    if (index >= 0) {
      return ok({ path: [...base, group, "hooks", index], value: hooks[index] });
    }
  }
  return ok(undefined);
}

/** The value of the locator's entry in a parsed document, or `undefined` when the document has none. */
export function entryValue(data: unknown, locator: ArtifactLocator): Result<JsonValue | undefined, UnexpectedShape> {
  const found = find(data, locator);
  return found.ok ? ok(found.value?.value as JsonValue | undefined) : found;
}

/** The containers on the way to `path` must be objects (or arrays where an index leads), never scalars. */
function shapeProblem(data: unknown, path: EntryPath): UnexpectedShape | undefined {
  let value: unknown = data;
  for (const [index, key] of path.entries()) {
    if (value === undefined) {
      return undefined;
    }
    const container: Container | undefined = isObject(value) || Array.isArray(value) ? value : undefined;
    if (container === undefined || Array.isArray(container) !== (typeof key === "number")) {
      return { _tag: "UnexpectedShape", detail: `/${path.slice(0, index).join("/")} cannot hold ${String(key)}` };
    }
    value = child(container, key);
  }
  return undefined;
}

/**
 * The edits that put `value` at the locator's entry in `data`, or remove the entry when `value` is undefined. A new
 * list element goes at the end of its list; a new hook goes into a group of its own. A removal leaves no empty
 * container: removing a group's last hook removes the group, and every container above it that holds nothing else.
 */
export function entryEdits(
  data: unknown,
  locator: ArtifactLocator,
  value: JsonValue | undefined
): Result<readonly EntryEdit[], UnexpectedShape> {
  const found = find(data, locator);
  if (!found.ok) {
    return found;
  }
  const base = pointerKeys(locator.pointer ?? "");
  const problem = shapeProblem(data, locator.member === undefined ? base.slice(0, -1) : base);
  if (problem !== undefined) {
    return err(problem);
  }
  const hit = found.value;
  if (value !== undefined) {
    if (hit !== undefined) {
      return ok([{ path: hit.path, value }]);
    }
    if (locator.member === undefined) {
      return ok([{ path: base, value }]);
    }
    const element: JsonValue = locator.memberIn === "hook-group" ? { hooks: [value] } : value;
    const list = at(data, base);
    return ok(
      Array.isArray(list)
        ? [{ path: [...base, list.length], value: element, insert: true }]
        : [{ path: base, value: [element] }]
    );
  }
  if (hit === undefined) {
    return ok([]);
  }
  if (locator.memberIn !== "hook-group") {
    return ok([{ path: emptiedAncestor(data, hit.path), value: undefined }]);
  }
  const [group = 0] = hit.path.slice(base.length);
  const hooks = at(data, [...base, group, "hooks"]);
  const removed = Array.isArray(hooks) && hooks.length > 1 ? hit.path : emptiedAncestor(data, [...base, group]);
  return ok([{ path: removed, value: undefined }]);
}

/**
 * What to remove so that removing `path` leaves no empty container behind: the outermost ancestor below the document
 * root whose only content is the way to `path`, such as an event's hook list holding only the removed group, and the
 * `hooks` object holding only that list.
 */
function emptiedAncestor(data: unknown, path: EntryPath): EntryPath {
  let removed = path;
  while (removed.length > 1) {
    const parent = at(data, removed.slice(0, -1));
    const size = Array.isArray(parent) ? parent.length : isObject(parent) ? Object.keys(parent).length : 0;
    if (size !== 1) {
      break;
    }
    removed = removed.slice(0, -1);
  }
  return removed;
}

/**
 * The entries a document holds under `pointer`: each hook of an event's hook groups when `memberIn` is `hook-group`
 * (the pointer names the object of events, such as `/hooks`), or each element of the list at `pointer`. Only
 * elements with an identity are listed, since only those can be addressed.
 */
export function listEntries(
  data: unknown,
  pointer: string,
  memberIn: "element" | "hook-group"
): readonly {
  readonly locator: Pick<ArtifactLocator, "pointer" | "member" | "memberIn">;
  readonly value: JsonValue;
}[] {
  const keys = pointerKeys(pointer);
  const container = at(data, keys);
  const escape = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");
  if (memberIn === "element") {
    return Array.isArray(container)
      ? container.flatMap((element) => {
          const member = identity(element);
          return member === undefined ? [] : [{ locator: { pointer, member }, value: element as JsonValue }];
        })
      : [];
  }
  if (!isObject(container)) {
    return [];
  }
  return Object.entries(container).flatMap(([event, groups]) =>
    (Array.isArray(groups) ? groups : []).flatMap((group) => {
      const hooks = isObject(group) && Array.isArray(group.hooks) ? group.hooks : [];
      return hooks.flatMap((hook) => {
        const member = identity(hook);
        return member === undefined
          ? []
          : [
              {
                locator: { pointer: `${pointer}/${escape(event)}`, member, memberIn: "hook-group" as const },
                value: hook as JsonValue
              }
            ];
      });
    })
  );
}
