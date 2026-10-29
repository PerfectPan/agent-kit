import { FooterLayout } from "../../components/landing/footer-layout.tsx";
import { Link } from "@tanstack/react-router";

import { docsIndex, guide } from "../docs/index.ts";
import { text, type Lang } from "./copy.ts";
import { CHANGELOG_URL, GITHUB_URL, NPM_URL } from "./projects.ts";
import { landingFacts } from "virtual:landing-facts";
import { Mascot } from "../../components/mascot.tsx";

export function LandingFooter({ lang }: { readonly lang: Lang }) {
  const docs = docsIndex();
  const api = guide("api");
  return (
    <FooterLayout
      brand={
        <Link to="/" className="brand">
          <Mascot state="idle" />
          agent-kit
        </Link>
      }
      summary={
        <>
          {landingFacts.version} · {landingFacts.license} · {text(lang, "footerBreak")}
        </>
      }
    >
      <Link to={docs}>{text(lang, "readGuide")}</Link>
      <Link to={api.to} params={api.params}>
        {text(lang, "apiReference")}
      </Link>
      <a href={NPM_URL}>{text(lang, "navNpm")}</a>
      <a href={GITHUB_URL}>{text(lang, "navGithub")}</a>
      <a href={CHANGELOG_URL}>{text(lang, "navChangelog")}</a>
    </FooterLayout>
  );
}
