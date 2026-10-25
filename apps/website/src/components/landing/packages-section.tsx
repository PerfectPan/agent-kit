import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { landingFacts } from "virtual:landing-facts";

import { barFillPercent, type ShownBudget } from "../../lib/entry-budgets.ts";
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

function entryList(entries: readonly ShownBudget[], lang: Lang) {
  const largest = Math.max(...entries.map((entry) => entry.bytes));
  return (
    <ul className="entries">
      {entries.map((entry) => {
        const blurb = BLURB[entry.entry];
        const guide = entryGuide(lang, entry.entry);
        return (
          <li key={entry.entry}>
            <Link to={guide.to} params={guide.params}>
              <code>{entry.entry}</code>
            </Link>
            <span>{blurb ? text(lang, blurb) : entry.entry}</span>
            <b className={entry.noImports ? "free" : undefined}>{entry.label}</b>
            <span className="budget-track" aria-hidden="true">
              <i style={{ "--fill": `${barFillPercent(entry.bytes, largest)}%` } as CSSProperties} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PackagesSection({ lang }: { readonly lang: Lang }) {
  return (
    <section className="section reveal">
      <h2>{text(lang, "connectTitle")}</h2>
      <p className="sub">{text(lang, "connectBody")}</p>
      <div className="packages">
        <div className="pkg">
          <h3>
            agent-kit <small>{text(lang, "connection")}</small>
          </h3>
          {entryList(landingFacts.budgets.kit, lang)}
          <div className="install">{INSTALL_KIT}</div>
        </div>
        <div className="pkg">
          <h3>
            agent-kit-collab <small>{text(lang, "coordination")}</small>
          </h3>
          {entryList(landingFacts.budgets.collab, lang)}
          <p className="note">{text(lang, "collabNote")}</p>
          <div className="install">{INSTALL_COLLAB}</div>
        </div>
      </div>
      <p className="legend">
        {text(lang, "legendBefore")}
        <b>{text(lang, "legendMark")}</b>
        {text(lang, "legendAfter")}
      </p>
    </section>
  );
}
