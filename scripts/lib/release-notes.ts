/**
 * The Version Packages pull request body: the fixed intro plus, for every package of the lockstep policy, the
 * package's section for the released version from its CHANGELOG.md. `body-path` does not raise the size limit:
 * create-pull-request truncates a longer body, from `body` or `body-path` alike, at GitHub's 65,536 characters —
 * mid-section. The script therefore cuts at 60,000, at a package boundary, and points at the CHANGELOG files for
 * the rest.
 */

export const RELEASE_PR_INTRO = `Coordinated Rush release prepared by the Version Packages workflow, which ran \`npm run check\` on this
content. Every push to \`main\` with pending change files regenerates this PR.

Pull requests created with the workflow token do not start CI. Review the version and changelog diff,
select **Ready for review** to run CI, then squash-merge. The merge tags the release, creates the
GitHub Release and publishes to npm from \`publish-npm.yml\`.`;

export const TRUNCATION_NOTICE =
  "_The remaining release notes exceed the pull request body limit; read them in each package's `CHANGELOG.md`._";

/** Stay safely below GitHub's 65,536-character pull request body limit. */
export const PR_BODY_CAP = 60_000;

export interface ReleaseNotesEntry {
  name: string;
  version: string;
  /** The package's full CHANGELOG.md content. */
  changelog: string;
}

/** Rush stamps every section with a line like "Sat, 17 Oct 2026 06:13:04 GMT" right under the heading. */
const RUSH_DATE_LINE = /^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * The lines after `## <version>` up to the next `## ` heading, without the generated date line and the surrounding
 * blank lines. `### ` subheadings do not end a section. Returns undefined when the changelog has no such heading.
 */
export function changelogSection(changelog: string, version: string): string | undefined {
  const lines = changelog.split("\n");
  const start = lines.indexOf(`## ${version}`);
  if (start === -1) {
    return undefined;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const body = (end === -1 ? rest : rest.slice(0, end)).filter((line) => !RUSH_DATE_LINE.test(line));
  const first = body.findIndex((line) => line.trim() !== "");
  if (first === -1) {
    return "";
  }
  let last = body.length - 1;
  while ((body[last] ?? "").trim() === "") {
    last -= 1;
  }
  return body.slice(first, last + 1).join("\n");
}

/** Renders the release PR body from the packages of the version policy, in rush.json order. */
export function renderReleaseNotes(entries: readonly ReleaseNotesEntry[], cap: number = PR_BODY_CAP): string {
  const sections = entries.map(({ name, version, changelog }) => {
    const section = changelogSection(changelog, version);
    if (section === undefined) {
      throw new Error(`no ${version} section in the CHANGELOG.md of ${name}`);
    }
    return `## ${name}@${version}\n\n${section}`;
  });
  let body = RELEASE_PR_INTRO;
  let truncated = false;
  // Reserve the notice and the blank line before it, or the truncated body ends up 2 characters past the cap.
  for (const section of sections) {
    const next = `${body}\n\n${section}`;
    if (next.length + TRUNCATION_NOTICE.length + 2 > cap) {
      truncated = true;
      break;
    }
    body = next;
  }
  return truncated ? `${body}\n\n${TRUNCATION_NOTICE}` : body;
}
