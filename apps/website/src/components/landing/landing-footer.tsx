import { Link } from "@tanstack/react-router";

import { text, type Lang } from "../../lib/landing-copy.ts";
import { CHANGELOG_URL, GITHUB_URL, NPM_URL } from "../../lib/projects.ts";
import { landingFacts } from "virtual:landing-facts";
import { Mascot } from "../mascot.tsx";

export function LandingFooter({ lang }: { readonly lang: Lang }) {
  return (
    <footer>
      <div className="wrap">
        <Link to={lang === "zh" ? "/zh" : "/"} className="brand">
          <Mascot state="idle" />
          agent-kit
        </Link>
        <span>
          {landingFacts.version} · {landingFacts.license} · {text(lang, "footerBreak")}
        </span>
        <nav>
          <a href={NPM_URL}>{text(lang, "navNpm")}</a>
          <a href={GITHUB_URL}>{text(lang, "navGithub")}</a>
          <a href={CHANGELOG_URL}>{text(lang, "navChangelog")}</a>
        </nav>
      </div>
    </footer>
  );
}
