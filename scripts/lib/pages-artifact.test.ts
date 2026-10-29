import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { archive, SHA, zip } from "./pages-artifact.test-support.ts";
import { MAX_ARTIFACT_BYTES, unpackArtifact } from "./pages-artifact.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pages-zip-test-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Pages artifact validation", () => {
  it.each([false, true])("preserves underscore paths and hidden nojekyll with deflate=%s", (deflate) => {
    expect(
      unpackArtifact(archive([{ name: "site/__tsr/data.json", value: "{}" }], 215, SHA, deflate), root, SHA, true)
    ).toBe(215);
    expect(readFileSync(join(root, "site/__tsr/data.json"), "utf8")).toBe("{}");
    expect(readFileSync(join(root, "site/.nojekyll"), "utf8")).toBe("");
  });

  it.each([true, "215", -1, 0, 215.5, "../1", 2_147_483_648, null])("rejects invalid PR number %s", (number) => {
    expect(() => unpackArtifact(archive([], number), root, SHA, true)).toThrow(/PR number or head SHA/u);
    expect(readdirSync(root)).toEqual([]);
  });
  it.each(["b".repeat(40), "not-a-sha"])('rejects incorrect SHA "%s"', (sha) => {
    expect(() => unpackArtifact(archive([], 215, sha), root, SHA, true)).toThrow(/PR number or head SHA/u);
  });
  it.each([
    "../escape",
    "/escape",
    "site/../../escape",
    "site/./x",
    "site//x",
    "site\\x",
    "site/\0x",
    "site/.git/config",
    "site/.github/workflows/x.yml",
    "site/.gitattributes",
    "site/pr-preview",
    "site/pr-preview/pr-1/index.html",
    "unexpected",
    "site/index.html"
  ])("rejects unsafe entry %s before writing", (name) => {
    expect(() => unpackArtifact(archive([{ name, value: "bad" }]), root, SHA, true)).toThrow(/artifact|ZIP|buffer/iu);
    expect(readdirSync(root)).toEqual([]);
  });
  it.each([0xa1ff, 0x21ff, 0x11ff])("rejects links and special files (mode %s)", (mode) => {
    expect(() =>
      unpackArtifact(archive([{ name: "site/escape", value: "../../somewhere", mode }]), root, SHA, true)
    ).toThrow(/artifact|ZIP|buffer/iu);
  });
  it("enforces uncompressed size and metadata limits", () => {
    expect(() =>
      unpackArtifact(archive([{ name: "site/huge", value: "small", size: MAX_ARTIFACT_BYTES }]), root, SHA, true)
    ).toThrow(/too large/u);
    expect(() => unpackArtifact(zip([{ name: "metadata.json", value: " ".repeat(1025) }]), root, SHA, true)).toThrow(
      /metadata/u
    );
    expect(readdirSync(root)).toEqual([]);
  });
  it("requires production to have no PR number", () => {
    expect(() => unpackArtifact(archive(), root, SHA, false)).toThrow(/artifact|ZIP|buffer/iu);
    expect(unpackArtifact(archive([], 0), root, SHA, false)).toBe(0);
  });
  it("rejects missing metadata or an index that is a directory", () => {
    expect(() => unpackArtifact(zip([{ name: "site/index.html", value: "index" }]), root, SHA, true)).toThrow(
      /metadata/u
    );
    expect(() =>
      unpackArtifact(
        zip([
          { name: "metadata.json", value: JSON.stringify({ pr_number: 215, head_sha: SHA }) },
          { name: "site/index.html/", value: "", mode: 0x41ed }
        ]),
        root,
        SHA,
        true
      )
    ).toThrow(/artifact|ZIP|buffer/iu);
  });
  it("rejects file/directory collisions and corrupt payloads before writing", () => {
    for (const extra of [
      [
        { name: "site/assets", value: "file" },
        { name: "site/assets/a.js", value: "bad" }
      ],
      [{ name: "site/bad", value: "bad", checksum: 0 }],
      [{ name: "site/bad", value: "bad", size: 1 }]
    ]) {
      expect(() => unpackArtifact(archive(extra, 215, SHA, true), root, SHA, true)).toThrow(/artifact|ZIP|buffer/iu);
      expect(readdirSync(root)).toEqual([]);
    }
  });
  it("rejects truncated archives and inconsistent local headers", () => {
    const invalid = archive();
    invalid.writeUInt16LE(1, 6);
    for (const data of [Buffer.alloc(0), archive().subarray(0, -1), invalid]) {
      expect(() => unpackArtifact(data, root, SHA, true)).toThrow(/artifact|ZIP|buffer/iu);
      expect(readdirSync(root)).toEqual([]);
    }
  });
});
