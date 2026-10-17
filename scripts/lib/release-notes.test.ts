import { describe, expect, it } from "vite-plus/test";

import { RELEASE_PR_INTRO, renderReleaseNotes, TRUNCATION_NOTICE } from "./release-notes.ts";

const kit = `# Change Log - @rivus/agent-kit

This log was last generated on Sat, 17 Oct 2026 06:13:04 GMT and should not be manually modified.

## 0.19.0
Sat, 17 Oct 2026 06:13:04 GMT

### Patches

- Scope verification to the selected agents.
- Remove empty install-created configuration files.

## 0.18.0
Fri, 16 Oct 2026 06:29:41 GMT

### Updates

- An older note that stays in the file.

## 0.17.0
Thu, 15 Oct 2026 06:07:53 GMT

_Version update only_
`;

const collab = `# Change Log - @rivus/agent-kit-collab

This log was last generated on Sat, 17 Oct 2026 06:13:04 GMT and should not be manually modified.

## 0.19.0
Sat, 17 Oct 2026 06:13:04 GMT

_Version update only_
`;

const entries = [
  { name: "@rivus/agent-kit", version: "0.19.0", changelog: kit },
  { name: "@rivus/agent-kit-collab", version: "0.19.0", changelog: collab }
];

describe("renderReleaseNotes", () => {
  it("extracts the newest version's section without its heading and generated date line", () => {
    expect(
      renderReleaseNotes([entries[0]!]).endsWith(
        "### Patches\n\n- Scope verification to the selected agents.\n- Remove empty install-created configuration files."
      )
    ).toBe(true);
    expect(renderReleaseNotes([entries[0]!])).not.toContain(" GMT");
  });

  it("ends an older version's section at the next heading", () => {
    expect(
      renderReleaseNotes([{ name: "@rivus/agent-kit", version: "0.18.0", changelog: kit }]).endsWith(
        "### Updates\n\n- An older note that stays in the file."
      )
    ).toBe(true);
  });

  it("fails with the package and version when the changelog lacks the section", () => {
    expect(() => renderReleaseNotes([{ name: "@rivus/agent-kit", version: "0.17.1", changelog: kit }])).toThrow(
      "no 0.17.1 section in the CHANGELOG.md of @rivus/agent-kit"
    );
  });

  it("lists every package of the policy in the given order under the intro", () => {
    const body = renderReleaseNotes(entries);
    const kitAt = body.indexOf("## @rivus/agent-kit@0.19.0");
    const collabAt = body.indexOf("## @rivus/agent-kit-collab@0.19.0");
    expect(body.startsWith(RELEASE_PR_INTRO)).toBe(true);
    expect(kitAt).toBeGreaterThan(RELEASE_PR_INTRO.length);
    expect(collabAt).toBeGreaterThan(kitAt);
    expect(body).toContain("### Patches\n\n- Scope verification to the selected agents.");
    expect(body).toContain("_Version update only_");
    expect(body).not.toContain("Sat, 17 Oct 2026");
  });

  it("cuts the entries past the cap and points at the CHANGELOG files", () => {
    const changelog = `## 0.19.0\n${"- a long change note that fills the body. ".repeat(12)}`;
    // The cap fits the intro, the first section and the notice with its separator; the second section does not.
    const cap = renderReleaseNotes([entries[0]!]).length + 2 + TRUNCATION_NOTICE.length + 1;
    const body = renderReleaseNotes([entries[0]!, { ...entries[1]!, changelog }], cap);
    expect(renderReleaseNotes([entries[0]!, { ...entries[1]!, changelog }]).length).toBeGreaterThan(cap);
    expect(body.startsWith(RELEASE_PR_INTRO)).toBe(true);
    expect(body).toContain("## @rivus/agent-kit@0.19.0");
    expect(body).not.toContain("## @rivus/agent-kit-collab@0.19.0");
    expect(body.endsWith(TRUNCATION_NOTICE)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(cap);
  });

  it("cuts a body that one huge section already fills and still points at the CHANGELOG files", () => {
    const changelog = `## 0.19.0\n${"x".repeat(500)}`;
    const cap = RELEASE_PR_INTRO.length + 200;
    const body = renderReleaseNotes([{ name: "@rivus/agent-kit", version: "0.19.0", changelog }], cap);
    expect(body.startsWith(RELEASE_PR_INTRO)).toBe(true);
    expect(body).not.toContain("## @rivus/agent-kit@0.19.0");
    expect(body.endsWith(TRUNCATION_NOTICE)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(cap);
  });
});
