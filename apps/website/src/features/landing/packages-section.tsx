import { EntryTable } from "../../components/landing/entry-table.tsx";
import { SectionHeading } from "../../components/landing/section-heading.tsx";
import { Link } from "@tanstack/react-router";
import { landingFacts } from "virtual:landing-facts";

import { groupedKitBudgets, type KitGroupId, type ShownBudget } from "./entry-budgets.ts";
import { entryGuide } from "../docs/index.ts";
import { text, type CopyKey, type Lang } from "./copy.ts";
import { INSTALL_COLLAB, INSTALL_KIT } from "./projects.ts";

const BLURB: Record<string, CopyKey> = {
  "/discovery": "blurbDiscovery",
  "/sessions": "blurbSessions",
  "/transcript": "blurbTranscript",
  "/transcript/usage": "blurbUsage",
  "/cost": "blurbCost",
  "/cost/prices": "blurbCostPrices",
  "/harness/events": "blurbEvents",
  "/harness": "blurbHarness",
  "/acp": "blurbAcp",
  "/redact": "blurbRedact",
  "/process-lock": "blurbLock",
  "/lease": "blurbLease",
  "/lanes": "blurbLanes"
};

const GROUP_COPY: Record<KitGroupId, CopyKey> = {
  read: "groupRead",
  hook: "groupHook",
  utilities: "groupUtilities"
};

function entryRow(entry: ShownBudget, lang: Lang) {
  const blurb = BLURB[entry.entry];
  const guide = entryGuide(entry.entry);
  return {
    id: entry.entry,
    link: (
      <Link to={guide.to} params={guide.params} className="group/entry">
        <code className="font-mono text-[14px] leading-[22px] font-medium text-ink [font-variant-ligatures:none] group-hover/entry:underline">
          {entry.entry}
        </code>
      </Link>
    ),
    description: blurb ? text(lang, blurb) : entry.entry,
    size: entry.label,
    note: entry.noImports ? text(lang, "noDeps") : undefined
  };
}

const GROUP_HEADING =
  "mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-2 text-[0.9375rem] leading-[1.3] font-[650] tracking-[-0.02em] text-balance text-ink zh:break-keep";

export function PackagesSection({ lang }: { readonly lang: Lang }) {
  const groups = groupedKitBudgets(landingFacts.budgets.kit);
  return (
    <section className="reveal grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-5 pt-16">
      <SectionHeading title={text(lang, "connectTitle")} body={text(lang, "connectBody")} />
      <div>
        <div className="grid gap-2">
          {groups.map((group, index) => (
            <div key={group.id}>
              <h3 className={`${GROUP_HEADING} ${index === 0 ? "mt-0" : "mt-4"}`}>
                {text(lang, GROUP_COPY[group.id])}
              </h3>
              <EntryTable entries={group.entries.map((entry) => entryRow(entry, lang))} />
            </div>
          ))}
          <div>
            <h3 className={`${GROUP_HEADING} mt-4`}>
              agent-kit-collab{" "}
              <small className="text-ui font-medium tracking-normal text-muted">{text(lang, "groupCollab")}</small>
            </h3>
            <EntryTable entries={landingFacts.budgets.collab.map((entry) => entryRow(entry, lang))} />
          </div>
        </div>
        <p className="mt-4 font-mono text-ui text-pretty text-muted zh:[line-break:strict]">
          {INSTALL_KIT}
          {" · "}
          {INSTALL_COLLAB}
        </p>
        <p className="mt-3 text-left font-mono text-micro text-pretty text-muted zh:[line-break:strict]">
          {text(lang, "legendBefore")}
        </p>
      </div>
    </section>
  );
}
