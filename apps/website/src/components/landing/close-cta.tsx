import { Link } from "@tanstack/react-router";

import { guide } from "../../lib/guide-paths.ts";
import { text, type Lang } from "../../lib/landing-copy.ts";

export function CloseCta({ lang }: { readonly lang: Lang }) {
  const start = guide("installation");
  const api = guide("api");
  return (
    <section className="close-cta reveal" aria-label={text(lang, "guidesTitle")}>
      <Link to={start.to} params={start.params} className="btn btn-primary">
        {text(lang, "getStarted")}
      </Link>
      <Link to={api.to} params={api.params} className="btn btn-ghost">
        {text(lang, "apiReference")}
      </Link>
    </section>
  );
}
