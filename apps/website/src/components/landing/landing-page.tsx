import { useEffect } from "react";

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
  useEffect(() => {
    const root = document.querySelector(".landing");
    if (!(root instanceof HTMLElement)) {
      return undefined;
    }
    const nodes = root.querySelectorAll(".reveal");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      for (const node of nodes) {
        node.classList.add("is-in");
      }
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries, current) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            current.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
    );
    for (const node of nodes) {
      observer.observe(node);
    }
    const frame = requestAnimationFrame(() => {
      root.setAttribute("data-motion", "on");
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

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
