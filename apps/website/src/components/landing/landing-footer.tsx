import { Link } from "@tanstack/react-router";

import { docsIndex, guide } from "../../lib/guide-paths.ts";
import { text, type Lang } from "../../lib/landing-copy.ts";
import { CHANGELOG_URL, GITHUB_URL, NPM_URL } from "../../lib/projects.ts";
import { landingFacts } from "virtual:landing-facts";
import { Mascot } from "../mascot.tsx";

export function LandingFooter({ lang }: { readonly lang: Lang }) {
  const docs = docsIndex();
  const api = guide("api");
  return (
    <footer>
      <div className="wrap">
        <Link to="/" className="brand">
          <Mascot state="idle" />
          agent-kit
        </Link>
        <span>
          {landingFacts.version} · {landingFacts.license} · {text(lang, "footerBreak")}
        </span>
        <nav>
          <Link to={docs}>{text(lang, "readGuide")}</Link>
          <Link to={api.to} params={api.params}>
            {text(lang, "apiReference")}
          </Link>
          <a href={NPM_URL}>{text(lang, "navNpm")}</a>
          <a href={GITHUB_URL}>{text(lang, "navGithub")}</a>
          <a href={CHANGELOG_URL}>{text(lang, "navChangelog")}</a>
        </nav>
      </div>
    </footer>
  );
}
