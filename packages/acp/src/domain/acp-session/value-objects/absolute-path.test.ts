import { describe, expect, it } from "vite-plus/test";

import { AbsolutePath } from "./absolute-path.js";

describe("client paths", () => {
  it("keeps .. for the platform to resolve and compares resolved paths by parts", () => {
    const root = AbsolutePath.parse("/work/project");
    const inside = AbsolutePath.parse("/work/project/./src//a.txt");
    const unresolved = AbsolutePath.parse("/work/project/src/../a.txt");
    const prefix = AbsolutePath.parse("/work/project-2/a.txt");
    const dots = AbsolutePath.parse("/work/project/..notes");
    expect(root && inside && inside.isWithin(root)).toBe(true);
    expect(unresolved && unresolved.format()).toBe("/work/project/src/../a.txt");
    expect(root && unresolved && unresolved.isWithin(root)).toBe(false);
    expect(root && prefix && prefix.isWithin(root)).toBe(false);
    expect(root && dots && dots.isWithin(root)).toBe(true);
    expect(inside && inside.format()).toBe("/work/project/src/a.txt");
    expect(AbsolutePath.parse("relative/a.txt")).toBeUndefined();
  });

  it("reads Windows drive paths with either separator", () => {
    const root = AbsolutePath.parse("c:\\work\\project");
    const inside = AbsolutePath.parse("C:/work/project/a.txt");
    expect(root && inside && inside.isWithin(root)).toBe(true);
    expect(inside && inside.format()).toBe("C:\\work\\project\\a.txt");
  });

  it.each(["", "C:relative", "\\work"])("leaves relative input %s undefined", (path) => {
    expect(AbsolutePath.parse(path)).toBeUndefined();
  });

  it.each([
    ["//work///./x/", "/work/x"],
    ["c:/", "C:\\"],
    ["/work\\item", "/work\\item"],
    ["/a/../b", "/a/../b"],
    ["/", "/"]
  ])("formats %s without resolving the file system", (path, expected) => {
    const parsed = AbsolutePath.parse(path);
    expect(parsed && parsed.format()).toBe(expected);
  });

  it.each([
    ["C:/work", "c:/work/x", true],
    ["C:/work", "C:/Work/x", false],
    ["C:/work", "D:/work/x", false],
    ["/work", "/work/../x", false],
    ["/work/..", "/work/../x", false]
  ] as const)("compares %s and %s by their preserved parts", (root, path, expected) => {
    const a = AbsolutePath.parse(root);
    const b = AbsolutePath.parse(path);
    expect(a && b && b.isWithin(a)).toBe(expected);
  });

  it("owns parts across prefixes and appended paths without freezing caller data", () => {
    const path = AbsolutePath.parse("/work/project/a.txt") as AbsolutePath;
    const prefix = path.prefix(2);
    const parts = ["b.txt"];
    const appended = prefix.append(parts);
    parts[0] = "changed";
    expect(path.format()).toBe("/work/project/a.txt");
    expect(prefix.format()).toBe("/work/project");
    expect(appended.format()).toBe("/work/project/b.txt");
    expect(Object.isFrozen(parts)).toBe(false);
    for (const value of [path, prefix, appended]) {
      expect(Object.isFrozen(value)).toBe(true);
      expect(Object.isFrozen(value.parts)).toBe(true);
    }
  });
});
