import { Link } from "@tanstack/react-router";
import { landingFacts } from "virtual:landing-facts";

import { groupedKitBudgets, type KitGroupId, type ShownBudget } from "../../lib/entry-budgets.ts";
import { entryGuide } from "../../lib/guide-paths.ts";
import { text, type CopyKey, type Lang } from "../../lib/landing-copy.ts";
import { INSTALL_COLLAB, INSTALL_KIT } from "../../lib/projects.ts";

const BLURB: Record<string, CopyKey> = {
  "/discovery": "blurbDiscovery",
  "/sessions": "blurbSessions",
  "/transcript": "blurbTranscript",
  "/transcript/usage": "blurbUsage",
  "/cost": "blurbCost",
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
  return (
    <li key={entry.entry}>
      <Link to={guide.to} params={guide.params}>
        <code>{entry.entry}</code>
      </Link>
      <span>{blurb ? text(lang, blurb) : entry.entry}</span>
      <span className="size">
        <b>{entry.label}</b>
        {entry.noImports ? <em>{text(lang, "noDeps")}</em> : null}
      </span>
    </li>
  );
}

export function PackagesSection({ lang }: { readonly lang: Lang }) {
  const groups = groupedKitBudgets(landingFacts.budgets.kit);
  return (
    <section className="section reveal">
      <div className="section-head">
        <h2>{text(lang, "connectTitle")}</h2>
        <p className="sub">{text(lang, "connectBody")}</p>
      </div>
      <div className="section-body">
        <div className="catalog">
          {groups.map((group) => (
            <div key={group.id} className="catalog-group">
              <h3>{text(lang, GROUP_COPY[group.id])}</h3>
              <ul className="entries">{group.entries.map((entry) => entryRow(entry, lang))}</ul>
            </div>
          ))}
          <div className="catalog-group">
            <h3>
              agent-kit-collab <small>{text(lang, "groupCollab")}</small>
            </h3>
            <ul className="entries">{landingFacts.budgets.collab.map((entry) => entryRow(entry, lang))}</ul>
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
