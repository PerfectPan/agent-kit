import type { ShownBudget } from "../../lib/entry-budgets.ts";
import { text, type CopyKey, type Lang } from "../../lib/landing-copy.ts";
import { INSTALL_COLLAB, INSTALL_KIT } from "../../lib/projects.ts";
import { landingFacts } from "virtual:landing-facts";

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
  return (
    <ul className="entries">
      {entries.map((entry) => {
        const blurb = BLURB[entry.entry];
        return (
          <li key={entry.entry}>
            <code>{entry.entry}</code>
            <span>{blurb ? text(lang, blurb) : entry.entry}</span>
            <b className={entry.noImports ? "free" : undefined}>{entry.label}</b>
          </li>
        );
      })}
    </ul>
  );
}

export function PackagesSection({ lang }: { readonly lang: Lang }) {
  return (
    <section className="section">
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
