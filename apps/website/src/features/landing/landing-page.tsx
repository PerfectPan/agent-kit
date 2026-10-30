import { useInView } from "../../hooks/use-in-view.ts";
import { WRAP } from "../../components/landing/wrap.ts";

import type { Lang } from "./copy.ts";
import { CloseCta } from "./close-cta.tsx";
import { LandingFooter } from "./landing-footer.tsx";
import { LandingHeader } from "./landing-header.tsx";
import { LandingHero } from "./landing-hero.tsx";
import { LayerSection } from "../layer/index.ts";
import { PackagesSection } from "./packages-section.tsx";
import { ProjectsSection } from "./projects-section.tsx";
import { ProvidersSection } from "./providers-section.tsx";

// Both trees are prerendered; <html lang>, which the boot script sets before hydration, picks the visible one.
const TREE_VISIBILITY: Record<Lang, string> = {
  en: "in-[html[lang=zh]]:invisible in-[html[lang=zh]]:pointer-events-none",
  zh: "invisible pointer-events-none in-[html[lang=zh]]:visible in-[html[lang=zh]]:pointer-events-auto"
};

export function LandingPage({ lang }: { readonly lang: Lang }) {
  const rootRef = useInView({
    selector: ".reveal",
    visibleClass: "is-in",
    motionAttribute: "data-motion",
    motionValue: "on",
    threshold: 0.16,
    rootMargin: "0px 0px -8% 0px"
  });

  return (
    <div
      ref={rootRef}
      className={`${TREE_VISIBILITY[lang]} col-start-1 row-start-1 text-ink selection:bg-honey selection:text-ink [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-3 [&_:focus-visible]:outline-ochre`}
      data-lang={lang}
    >
      <LandingHeader lang={lang} />
      <main className={WRAP}>
        <LandingHero lang={lang} />
        <LayerSection lang={lang} />
        <ProjectsSection lang={lang} />
        <PackagesSection lang={lang} />
        <ProvidersSection lang={lang} />
        <CloseCta lang={lang} />
      </main>
      <LandingFooter lang={lang} />
    </div>
  );
}
