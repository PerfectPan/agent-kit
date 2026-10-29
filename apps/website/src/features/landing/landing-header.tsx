import { HeaderLayout } from "../../components/landing/header-layout.tsx";
import { Link } from "@tanstack/react-router";

import { docsIndex, guide } from "../docs/index.ts";
import { text, type Lang } from "./copy.ts";
import { GITHUB_URL } from "./projects.ts";
import { useLanguage } from "../../hooks/use-language.ts";
import { Mascot } from "../../components/mascot.tsx";

export function LandingHeader({ lang }: { readonly lang: Lang }) {
  const { setLang } = useLanguage();
  const docs = docsIndex();
  const api = guide("api");

  return (
    <HeaderLayout
      brand={
        <Link to="/" className="brand">
          <Mascot state="idle" />
          agent-kit
        </Link>
      }
    >
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
    </HeaderLayout>
  );
}
