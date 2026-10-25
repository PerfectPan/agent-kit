import { Link } from "@tanstack/react-router";

import { docsIndex, guide } from "../../lib/guide-paths.ts";
import { text, type Lang } from "../../lib/landing-copy.ts";
import { GITHUB_URL } from "../../lib/projects.ts";
import { useLanguage } from "../root-shell.tsx";
import { Mascot } from "../mascot.tsx";

export function LandingHeader({ lang }: { readonly lang: Lang }) {
  const { setLang } = useLanguage();
  const docs = docsIndex();
  const api = guide("api");

  return (
    <header className="nav">
      <div className="wrap">
        <Link to="/" className="brand">
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
            <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>
              {text(lang, "langEn")}
            </button>
            <button type="button" aria-pressed={lang === "zh"} onClick={() => setLang("zh")}>
              {text(lang, "langZh")}
            </button>
          </span>
        </nav>
      </div>
    </header>
  );
}
