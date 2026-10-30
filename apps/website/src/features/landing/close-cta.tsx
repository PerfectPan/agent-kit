import { Link } from "@tanstack/react-router";

import { guide } from "../docs/index.ts";
import { text, type Lang } from "./copy.ts";
import { GHOST_BUTTON, PRIMARY_BUTTON } from "./button-classes.ts";

export function CloseCta({ lang }: { readonly lang: Lang }) {
  const start = guide("installation");
  const api = guide("api");
  return (
    <section className="reveal mt-14 flex flex-wrap gap-3 pt-2" aria-label={text(lang, "guidesTitle")}>
      <Link to={start.to} params={start.params} className={PRIMARY_BUTTON}>
        {text(lang, "getStarted")}
      </Link>
      <Link to={api.to} params={api.params} className={GHOST_BUTTON}>
        {text(lang, "apiReference")}
      </Link>
    </section>
  );
}
