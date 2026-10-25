import { Link } from "@tanstack/react-router";
import { landingFacts } from "virtual:landing-facts";

import { guide } from "../../lib/guide-paths.ts";
import { text, type Lang } from "../../lib/landing-copy.ts";
import { INSTALL_KIT } from "../../lib/projects.ts";
import { CodeDemo } from "./code-demo.tsx";
import { CopyButton } from "./copy-button.tsx";

export function LandingHero({ lang }: { readonly lang: Lang }) {
  const start = guide("installation");
  return (
    <section className="hero">
      <div className="hero-copy">
        <h1>{text(lang, "heroTitle")}</h1>
        <p className="lead">{text(lang, "heroLead")}</p>
        <div className="cta">
          <span className="pill">
            {INSTALL_KIT} <CopyButton value={INSTALL_KIT} lang={lang} />
          </span>
          <Link to={start.to} params={start.params} className="btn btn-primary">
            {text(lang, "getStarted")}
          </Link>
        </div>
      </div>
      <div className="hero-demo">
        <CodeDemo lang={lang} />
        <p className="facts-note" aria-label={text(lang, "factsStrip")}>
          {landingFacts.entryCount} {text(lang, "factsEntries")}
          {" · "}
          {landingFacts.packageCount} {text(lang, "factsPackages")}
          {" · "}
          {landingFacts.zeroDepCount} {text(lang, "factsZeroDep")}
          {" · "}
          {text(lang, "factsTypescript")}
          {" · "}
          {landingFacts.license}
          {" · "}
          {landingFacts.version}
        </p>
      </div>
    </section>
  );
}
