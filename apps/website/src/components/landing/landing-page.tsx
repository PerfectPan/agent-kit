import { useEffect, useRef } from "react";

import type { Lang } from "../../lib/landing-copy.ts";
import { CloseCta } from "./close-cta.tsx";
import { LandingFooter } from "./landing-footer.tsx";
import { LandingHeader } from "./landing-header.tsx";
import { LandingHero } from "./landing-hero.tsx";
import { LayerSection } from "./layer-section.tsx";
import { PackagesSection } from "./packages-section.tsx";
import { ProjectsSection } from "./projects-section.tsx";
import { ProvidersSection } from "./providers-section.tsx";

export function LandingPage({ lang }: { readonly lang: Lang }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
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
