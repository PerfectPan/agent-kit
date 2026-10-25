import { Link } from "@tanstack/react-router";
import { landingFacts } from "virtual:landing-facts";

import { guide } from "../../lib/guide-paths.ts";
import { text, type Lang } from "../../lib/landing-copy.ts";
import { INSTALL_KIT } from "../../lib/projects.ts";
import { CodeDemo } from "./code-demo.tsx";
import { CopyButton } from "./copy-button.tsx";

export function LandingHero({ lang }: { readonly lang: Lang }) {
  const start = guide(lang, "installation");
  return (
    <section className="hero">
      <h1>{text(lang, "heroTitle")}</h1>
      <p className="lead">{text(lang, "heroLead")}</p>
      <div className="cta">
        <Link to={start.to} params={start.params} className="btn btn-primary">
          {text(lang, "getStarted")}
        </Link>
        <span className="pill">
          {INSTALL_KIT} <CopyButton value={INSTALL_KIT} lang={lang} />
        </span>
      </div>
      <CodeDemo lang={lang} />
      <ul className="facts" aria-label={text(lang, "factsStrip")}>
        <li>
          <strong>{landingFacts.entryCount}</strong> {text(lang, "factsEntries")}
        </li>
        <li>
          <strong>{landingFacts.packageCount}</strong> {text(lang, "factsPackages")}
        </li>
        <li>
          <strong>{landingFacts.zeroDepCount}</strong> {text(lang, "factsZeroDep")}
        </li>
        <li>
          <strong>{text(lang, "factsTypescript")}</strong>
        </li>
        <li>
          <strong>{landingFacts.license}</strong>
        </li>
        <li>
          <strong>{landingFacts.version}</strong>
        </li>
      </ul>
    </section>
  );
}
