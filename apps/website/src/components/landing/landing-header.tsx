import { Link, useNavigate } from "@tanstack/react-router";

import { docsIndex, guide } from "../../lib/guide-paths.ts";
import { text, type Lang } from "../../lib/landing-copy.ts";
import { LANG_STORAGE_KEY } from "../../lib/lang-preference.ts";
import { GITHUB_URL } from "../../lib/projects.ts";
import { Mascot } from "../mascot.tsx";

function homePath(lang: Lang): "/" | "/zh" {
  return lang === "zh" ? "/zh" : "/";
}

export function LandingHeader({ lang }: { readonly lang: Lang }) {
  const navigate = useNavigate();
  const docs = docsIndex(lang);
  const api = guide(lang, "api");

  function choose(next: Lang) {
    localStorage.setItem(LANG_STORAGE_KEY, next);
    if (next !== lang) {
      void navigate({ to: next === "zh" ? "/zh" : "/" });
    }
  }

  return (
    <header className="nav">
      <div className="wrap">
        <Link to={homePath(lang)} className="brand">
          <Mascot state="idle" />
          agent-kit
        </Link>
        <nav className="links" aria-label={text(lang, "primaryNav")}>
          <Link to={docs} className="hide-sm">
            {text(lang, "navDocs")}
          </Link>
          <Link to={api.to} params={api.params} className="hide-sm">
            {text(lang, "navApi")}
          </Link>
          <a href={GITHUB_URL}>{text(lang, "navGithub")}</a>
          <span className="lang" role="group" aria-label={text(lang, "languageGroup")}>
            <button type="button" aria-pressed={lang === "en"} onClick={() => choose("en")}>
              {text(lang, "langEn")}
            </button>
            <button type="button" aria-pressed={lang === "zh"} onClick={() => choose("zh")}>
              {text(lang, "langZh")}
            </button>
          </span>
        </nav>
      </div>
    </header>
  );
}
