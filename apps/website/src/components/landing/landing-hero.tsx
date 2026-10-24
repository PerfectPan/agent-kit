import { Link } from "@tanstack/react-router";

import { text, type Lang } from "../../lib/landing-copy.ts";
import { INSTALL_KIT } from "../../lib/projects.ts";
import { CodeDemo } from "./code-demo.tsx";
import { CopyButton } from "./copy-button.tsx";

function docsPath(lang: Lang): "/docs" | "/zh/docs" {
  return lang === "zh" ? "/zh/docs" : "/docs";
}

export function LandingHero({ lang }: { readonly lang: Lang }) {
  return (
    <section className="hero">
      <h1>{text(lang, "heroTitle")}</h1>
      <p className="lead">{text(lang, "heroLead")}</p>
      <div className="cta">
        <Link to={docsPath(lang)} className="btn btn-primary">
          {text(lang, "getStarted")}
        </Link>
        <span className="pill">
          {INSTALL_KIT} <CopyButton value={INSTALL_KIT} lang={lang} />
        </span>
      </div>
      <CodeDemo lang={lang} />
    </section>
  );
}
