import { HeaderLayout } from "../../components/landing/header-layout.tsx";
import { Link } from "@tanstack/react-router";

import { docsIndex, guide } from "../docs/index.ts";
import { text, type Lang } from "./copy.ts";
import { GITHUB_URL } from "./projects.ts";
import { useLanguage } from "../../hooks/use-language.ts";
import { Button } from "../../components/ui/button.tsx";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group.tsx";
import { BrandLink } from "./brand-link.tsx";

export function LandingHeader({ lang }: { readonly lang: Lang }) {
  const { setLang } = useLanguage();
  const docs = docsIndex();
  const api = guide("api");

  return (
    <HeaderLayout brand={<BrandLink size="header" />}>
      <nav className="flex items-center gap-1 text-[15px] text-ink-2" aria-label={text(lang, "primaryNav")}>
        <Button asChild variant="ghost" className="phone:hidden">
          <Link to={docs}>{text(lang, "navDocs")}</Link>
        </Button>
        <Button asChild variant="ghost" className="phone:hidden">
          <Link to={api.to} params={api.params}>
            {text(lang, "navApi")}
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <a href={GITHUB_URL}>{text(lang, "navGithub")}</a>
        </Button>
        <ToggleGroup
          variant="paper"
          className="ml-1.5"
          aria-label={text(lang, "languageGroup")}
          value={lang}
          onValueChange={(value) => {
            if (value === "en" || value === "zh") {
              setLang(value);
            }
          }}
        >
          <ToggleGroupItem variant="paper" value="en">
            {text(lang, "langEn")}
          </ToggleGroupItem>
          <ToggleGroupItem variant="paper" value="zh">
            {text(lang, "langZh")}
          </ToggleGroupItem>
        </ToggleGroup>
      </nav>
    </HeaderLayout>
  );
}
