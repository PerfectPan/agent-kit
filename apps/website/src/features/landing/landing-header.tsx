import { HeaderLayout } from "../../components/landing/header-layout.tsx";
import { Link } from "@tanstack/react-router";

import { docsIndex, guide } from "../docs/index.ts";
import { text, type Lang } from "./copy.ts";
import { GITHUB_URL } from "./projects.ts";
import { useLanguage } from "../../hooks/use-language.ts";
import { Mascot } from "../../components/mascot.tsx";
import { BRAND } from "./brand.ts";

const NAV_LINK =
  "rounded-control px-2.5 py-2 transition-[color,background-color] duration-200 ease-settle hover:bg-paper-2 hover:text-ink";
const LANG_BUTTON =
  "cursor-pointer rounded-control px-2.75 py-1 text-ui-sm font-medium text-ink-2 transition-[color,background-color,box-shadow] duration-200 ease-settle aria-pressed:bg-card aria-pressed:text-ink aria-pressed:shadow-[0_1px_2px_rgb(42_33_30/0.1)]";

export function LandingHeader({ lang }: { readonly lang: Lang }) {
  const { setLang } = useLanguage();
  const docs = docsIndex();
  const api = guide("api");

  return (
    <HeaderLayout
      brand={
        <Link to="/" className={`${BRAND} text-[21px]`}>
          <Mascot state="idle" className="size-7.5" />
          agent-kit
        </Link>
      }
    >
      <nav className="flex items-center gap-1 text-[15px] text-ink-2" aria-label={text(lang, "primaryNav")}>
        <Link to={docs} className={`${NAV_LINK} phone:hidden`}>
          {text(lang, "navDocs")}
        </Link>
        <Link to={api.to} params={api.params} className={`${NAV_LINK} phone:hidden`}>
          {text(lang, "navApi")}
        </Link>
        <a href={GITHUB_URL} className={NAV_LINK}>
          {text(lang, "navGithub")}
        </a>
        <span
          className="ml-1.5 inline-flex rounded-control bg-paper-2 p-0.75"
          role="group"
          aria-label={text(lang, "languageGroup")}
        >
          <button type="button" className={LANG_BUTTON} aria-pressed={lang === "en"} onClick={() => setLang("en")}>
            {text(lang, "langEn")}
          </button>
          <button type="button" className={LANG_BUTTON} aria-pressed={lang === "zh"} onClick={() => setLang("zh")}>
            {text(lang, "langZh")}
          </button>
        </span>
      </nav>
    </HeaderLayout>
  );
}
