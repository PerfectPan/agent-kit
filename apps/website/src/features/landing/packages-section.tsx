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
      <Link to={guide.to} params={guide.params}>
        <code>{entry.entry}</code>
      </Link>
    ),
    description: blurb ? text(lang, blurb) : entry.entry,
    size: entry.label,
    note: entry.noImports ? text(lang, "noDeps") : undefined
  };
}

export function PackagesSection({ lang }: { readonly lang: Lang }) {
  const groups = groupedKitBudgets(landingFacts.budgets.kit);
  return (
    <section className="section reveal">
      <SectionHeading title={text(lang, "connectTitle")} body={text(lang, "connectBody")} />
      <div className="section-body">
        <div className="catalog">
          {groups.map((group) => (
            <div key={group.id} className="catalog-group">
              <h3>{text(lang, GROUP_COPY[group.id])}</h3>
              <EntryTable entries={group.entries.map((entry) => entryRow(entry, lang))} />
            </div>
          ))}
          <div className="catalog-group">
            <h3>
              agent-kit-collab <small>{text(lang, "groupCollab")}</small>
            </h3>
            <EntryTable entries={landingFacts.budgets.collab.map((entry) => entryRow(entry, lang))} />
          </div>
        </div>
        <p className="catalog-install">
          {INSTALL_KIT}
          {" · "}
          {INSTALL_COLLAB}
        </p>
        <p className="legend">{text(lang, "legendBefore")}</p>
      </div>
    </section>
  );
}
