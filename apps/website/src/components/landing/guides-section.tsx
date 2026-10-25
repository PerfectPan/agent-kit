import { Link } from "@tanstack/react-router";

import { docsIndex, guide } from "../../lib/guide-paths.ts";
import { text, type Lang } from "../../lib/landing-copy.ts";

export function GuidesSection({ lang }: { readonly lang: Lang }) {
  const docs = docsIndex();
  const api = guide("api");
  return (
    <section className="final reveal">
      <h2>{text(lang, "guidesTitle")}</h2>
      <p>{text(lang, "guidesBody")}</p>
      <div className="cta">
        <Link to={docs} className="btn btn-primary">
          {text(lang, "readGuide")}
        </Link>
        <Link to={api.to} params={api.params} className="btn btn-ghost">
          {text(lang, "apiReference")}
        </Link>
      </div>
    </section>
  );
}
