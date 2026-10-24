import { Link } from "@tanstack/react-router";

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
    </section>
  );
}
