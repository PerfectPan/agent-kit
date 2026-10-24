import type { Lang } from "../../lib/landing-copy.ts";
import { GuidesSection } from "./guides-section.tsx";
import { LandingFooter } from "./landing-footer.tsx";
import { LandingHeader } from "./landing-header.tsx";
import { LandingHero } from "./landing-hero.tsx";
import { LayerSection } from "./layer-section.tsx";
import { PackagesSection } from "./packages-section.tsx";
import { ProjectsSection } from "./projects-section.tsx";
import { ProvidersSection } from "./providers-section.tsx";

export function LandingPage({ lang }: { readonly lang: Lang }) {
  return (
    <div className="landing" data-lang={lang}>
      <LandingHeader lang={lang} />
      <main className="wrap">
        <LandingHero lang={lang} />
        <LayerSection lang={lang} />
        <PackagesSection lang={lang} />
        <ProjectsSection lang={lang} />
        <ProvidersSection lang={lang} />
        <GuidesSection lang={lang} />
      </main>
      <LandingFooter lang={lang} />
    </div>
  );
}
