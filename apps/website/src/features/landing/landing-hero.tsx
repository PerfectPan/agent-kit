import { Link } from "@tanstack/react-router";
import { landingFacts } from "virtual:landing-facts";

import { guide } from "../docs/index.ts";
import { text, type Lang } from "./copy.ts";
import { INSTALL_KIT } from "./projects.ts";
import { DemoSection } from "../demo/index.ts";
import { useClipboard } from "../../hooks/use-clipboard.ts";
import { CopyButton } from "../../components/landing/copy-button.tsx";

export function LandingHero({ lang }: { readonly lang: Lang }) {
  const { copied, copy } = useClipboard(INSTALL_KIT);
  const start = guide("installation");
  return (
    <section className="hero">
      <div className="hero-copy">
        <h1>{text(lang, "heroTitle")}</h1>
        <p className="lead">{text(lang, "heroLead")}</p>
        <div className="cta">
          <span className="pill">
            {INSTALL_KIT}{" "}
            <CopyButton
              copied={copied}
              label={text(lang, copied ? "copied" : "copy")}
              title={text(lang, copied ? "copied" : "copyInstall")}
              onCopy={copy}
            />
          </span>
          <Link to={start.to} params={start.params} className="btn btn-primary">
            {text(lang, "getStarted")}
          </Link>
        </div>
      </div>
      <div className="hero-demo">
        <DemoSection lang={lang} />
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
