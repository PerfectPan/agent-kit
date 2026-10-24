import { Link } from "@tanstack/react-router";

import { text, type Lang } from "../../lib/landing-copy.ts";

function docsPath(lang: Lang): "/docs" | "/zh/docs" {
  return lang === "zh" ? "/zh/docs" : "/docs";
}

export function GuidesSection({ lang }: { readonly lang: Lang }) {
  const docs = docsPath(lang);
  return (
    <section className="final">
      <h2>{text(lang, "guidesTitle")}</h2>
      <p>{text(lang, "guidesBody")}</p>
      <div className="cta">
        <Link to={docs} className="btn btn-primary">
          {text(lang, "readGuide")}
        </Link>
        <Link to={docs} className="btn btn-ghost">
          {text(lang, "apiReference")}
        </Link>
      </div>
    </section>
  );
}
