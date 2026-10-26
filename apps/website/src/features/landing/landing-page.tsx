import { useInView } from "../../hooks/use-in-view.ts";

import type { Lang } from "./copy.ts";
import { CloseCta } from "./close-cta.tsx";
import { LandingFooter } from "./landing-footer.tsx";
import { LandingHeader } from "./landing-header.tsx";
import { LandingHero } from "./landing-hero.tsx";
import { LayerSection } from "../layer/index.ts";
import { PackagesSection } from "./packages-section.tsx";
import { ProjectsSection } from "./projects-section.tsx";
import { ProvidersSection } from "./providers-section.tsx";

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
    <div ref={rootRef} className="landing" data-lang={lang}>
      <LandingHeader lang={lang} />
      <main className="wrap">
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
