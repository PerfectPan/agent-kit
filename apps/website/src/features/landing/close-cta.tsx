import { Link } from "@tanstack/react-router";

import { guide } from "../docs/index.ts";
import { text, type Lang } from "./copy.ts";
import { Button } from "../../components/ui/button.tsx";

export function CloseCta({ lang }: { readonly lang: Lang }) {
  const start = guide("installation");
  const api = guide("api");
  return (
    <section className="reveal mt-14 flex flex-wrap gap-3 pt-2" aria-label={text(lang, "guidesTitle")}>
      <Button asChild size="lg">
        <Link to={start.to} params={start.params}>
          {text(lang, "getStarted")}
        </Link>
      </Button>
      <Button asChild variant="card" size="lg">
        <Link to={api.to} params={api.params}>
          {text(lang, "apiReference")}
        </Link>
      </Button>
    </section>
  );
}
