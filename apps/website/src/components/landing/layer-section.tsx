import { useEffect, useState } from "react";
import { landingFacts } from "virtual:landing-facts";

import { CONNECTION_FNS, COORDINATION_FNS, providerSupportsLayerFn, type LayerFn } from "../../lib/layer-functions.ts";
import { text, type CopyKey, type Lang } from "../../lib/landing-copy.ts";

const TOOLS: readonly CopyKey[] = [
  "toolUsage",
  "toolStatus",
  "toolHook",
  "toolEditor",
  "toolOrchestrator",
  "toolRunner",
  "toolViewer"
];

const PACKET_MS = 1500;

export function LayerSection({ lang }: { readonly lang: Lang }) {
  const support = landingFacts.support;
  const [active, setActive] = useState<LayerFn | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }
    const timer = window.setInterval(() => setTick((current) => current + 1), PACKET_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const hotTool = tick % TOOLS.length;
  const hotProvider = tick % support.length;

  function bindFn(name: LayerFn) {
    return {
      tabIndex: 0,
      className: active === name ? "is-active" : undefined,
      onMouseEnter: () => setActive(name),
      onMouseLeave: () => setActive(null),
      onFocus: () => setActive(name),
      onBlur: () => setActive(null)
    };
  }

  return (
    <section className="layer reveal">
      <h2>{text(lang, "layerTitle")}</h2>
      <p>{text(lang, "layerBody")}</p>
      <div className="stack">
        <div className="tier">
          <b>{text(lang, "yourTools")}</b>
          <div className="row">
            {TOOLS.map((key, index) => (
              <span key={key} className={active === null && index === hotTool ? "is-hot" : undefined}>
                {text(lang, key)}
              </span>
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
              {CONNECTION_FNS.map((name) => (
                <code key={name} {...bindFn(name)}>
                  {name}
                </code>
              ))}
            </div>
            <div>
              <em>{text(lang, "coordination")} · agent-kit-collab</em>
              {COORDINATION_FNS.map((name) => (
                <code key={name} {...bindFn(name)}>
                  {name}
                </code>
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
            {support.map((row, index) => {
              const className =
                active !== null
                  ? providerSupportsLayerFn(row, active)
                    ? "is-lit"
                    : "is-dim"
                  : index === hotProvider
                    ? "is-hot"
                    : undefined;
              return (
                <span key={row.id} className={className}>
                  {row.id}
                </span>
              );
            })}
            <span className={active !== null ? "yours is-lit" : "yours"}>{text(lang, "yourAgent")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
