import { Link } from "@tanstack/react-router";
import { landingFacts } from "virtual:landing-facts";

import { guide } from "../docs/index.ts";
import { text, type Lang } from "./copy.ts";
import { INSTALL_KIT } from "./projects.ts";
import { DemoSection } from "../demo/index.ts";
import { useClipboard } from "../../hooks/use-clipboard.ts";
import { CopyButton } from "../../components/landing/copy-button.tsx";
import { Button } from "../../components/ui/button.tsx";
import { cn } from "../../lib/utils.ts";

// The Chinese headline and lead keep their own size and measure at every width.
const HEADLINE: Record<Lang, string> = {
  en: "max-w-[11em] text-display tracking-[-0.035em] xl:max-w-none xl:text-[length:clamp(2.35rem,2.6vw+1rem,3.75rem)]",
  zh: "max-w-[12em] text-[length:clamp(2rem,4vw,3.25rem)] leading-[1.18] font-extrabold tracking-[-0.01em] break-keep"
};
const LEAD: Record<Lang, string> = {
  en: "max-w-[38ch] text-[18px] leading-[1.55] xl:max-w-none",
  zh: "max-w-[28em] text-[17px] leading-[1.75]"
};

export function LandingHero({ lang }: { readonly lang: Lang }) {
  const { copied, copy } = useClipboard(INSTALL_KIT);
  const start = guide("installation");
  return (
    <section className="grid gap-7 pt-12 text-left phone:pt-8 xl:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)] xl:items-center xl:gap-x-14 xl:pt-18">
      <div>
        <h1 className={cn("mb-4 text-balance motion-safe:animate-enter", HEADLINE[lang])}>{text(lang, "heroTitle")}</h1>
        <p className={cn("mb-6 text-ink-2 [--enter-delay:70ms] motion-safe:animate-enter", LEAD[lang])}>
          {text(lang, "heroLead")}
        </p>
        <div className="flex flex-wrap items-center justify-start gap-3 [--enter-delay:140ms] motion-safe:animate-enter">
          <span className="inline-flex items-center gap-3.5 rounded-control bg-card px-4.5 py-3 font-mono text-ui shadow-card">
            {INSTALL_KIT}{" "}
            <CopyButton
              copied={copied}
              label={text(lang, copied ? "copied" : "copy")}
              title={text(lang, copied ? "copied" : "copyInstall")}
              onCopy={copy}
            />
          </span>
          <Button asChild size="lg">
            <Link to={start.to} params={start.params}>
              {text(lang, "getStarted")}
            </Link>
          </Button>
        </div>
      </div>
      <div className="min-w-0">
        <DemoSection lang={lang} />
        <p
          className="mt-2.5 font-sans text-micro text-muted-foreground [--enter-delay:280ms] motion-safe:animate-enter"
          aria-label={text(lang, "factsStrip")}
        >
          {landingFacts.entryCount} {text(lang, "factsEntries")}
          {" · "}
          {landingFacts.packageCount} {text(lang, "factsPackages")}
          {" · "}
          {landingFacts.zeroDepCount} {text(lang, "factsZeroDep")}
          {" · "}
          {text(lang, "factsTypescript")}
          {" · "}
          {landingFacts.license}
          {" · "}
          {landingFacts.version}
        </p>
      </div>
    </section>
  );
}
