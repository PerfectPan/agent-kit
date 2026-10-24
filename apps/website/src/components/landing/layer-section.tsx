import { text, type CopyKey, type Lang } from "../../lib/landing-copy.ts";
import { landingFacts } from "virtual:landing-facts";

const TOOLS: readonly CopyKey[] = [
  "toolUsage",
  "toolStatus",
  "toolHook",
  "toolEditor",
  "toolOrchestrator",
  "toolRunner",
  "toolViewer"
];

const CONNECTION = [
  "detectAgents",
  "listSessions",
  "loadTranscript",
  "scanUsage",
  "summarize",
  "readHookEvent",
  "planInstall",
  "connectAgent",
  "redactText"
] as const;

const COORDINATION = ["acquireProcessLock", "createLeaseManager", "createLanes"] as const;

export function LayerSection({ lang }: { readonly lang: Lang }) {
  return (
    <section className="layer">
      <h2>{text(lang, "layerTitle")}</h2>
      <p>{text(lang, "layerBody")}</p>
      <div className="stack">
        <div className="tier">
          <b>{text(lang, "yourTools")}</b>
          <div className="row">
            {TOOLS.map((key) => (
              <span key={key}>{text(lang, key)}</span>
            ))}
          </div>
        </div>
        <div className="link" aria-hidden="true">
          <span />
          <i />
        </div>
        <div className="tier core">
          <b>{text(lang, "toolkit")}</b>
          <div className="row two">
            <div>
              <em>{text(lang, "connection")} · agent-kit</em>
              {CONNECTION.map((name) => (
                <code key={name}>{name}</code>
              ))}
            </div>
            <div>
              <em>{text(lang, "coordination")} · agent-kit-collab</em>
              {COORDINATION.map((name) => (
                <code key={name}>{name}</code>
              ))}
            </div>
          </div>
        </div>
        <div className="link" aria-hidden="true">
          <span />
          <i />
        </div>
        <div className="tier providers">
          <b>{text(lang, "providersLabel")}</b>
          <div className="row">
            {landingFacts.support.map((row) => (
              <span key={row.id}>{row.id}</span>
            ))}
            <span className="yours">{text(lang, "yourAgent")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
