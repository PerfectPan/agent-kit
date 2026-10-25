import { useState } from "react";
import { landingFacts } from "virtual:landing-facts";

import {
  CONNECTION_FNS,
  COORDINATION_FNS,
  TOOL_IDS,
  providerSupportsLayerFn,
  resolveLayerPath,
  type ToolId
} from "../../lib/layer-functions.ts";
import { text, type CopyKey, type Lang } from "../../lib/landing-copy.ts";
import { LayerConnectors } from "./layer-connectors.tsx";

const TOOL_COPY: Record<ToolId, CopyKey> = {
  usage: "toolUsage",
  status: "toolStatus",
  hook: "toolHook",
  editor: "toolEditor",
  orchestrator: "toolOrchestrator",
  runner: "toolRunner",
  viewer: "toolViewer"
};

export function LayerSection({ lang }: { readonly lang: Lang }) {
  const support = landingFacts.support;
  const [focus, setFocus] = useState<string | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const path = resolveLayerPath(focus);

  function bind(id: string) {
    return {
      tabIndex: 0,
      onMouseEnter: () => setFocus(id),
      onMouseLeave: () => setFocus(null),
      onFocus: () => setFocus(id),
      onBlur: () => setFocus(null)
    };
  }

  return (
    <section className="layer reveal">
      <div className="layer-head">
        <h2>{text(lang, "layerTitle")}</h2>
        <p>{text(lang, "layerBody")}</p>
      </div>
      <div ref={setHost} className="stack">
        <LayerConnectors host={host} path={path} />
        <div className="tier">
          <b>{text(lang, "yourTools")}</b>
          <div className="row">
            {TOOL_IDS.map((tool) => (
              <button
                key={tool}
                type="button"
                data-node={`tool:${tool}`}
                className={path.tool === tool ? "is-hot" : "is-idle"}
                aria-pressed={path.tool === tool}
                {...bind(tool)}
              >
                {text(lang, TOOL_COPY[tool])}
              </button>
            ))}
          </div>
        </div>
        <div className="tier core">
          <b>{text(lang, "toolkit")}</b>
          <div className="row fns">
            <div className={path.collab ? "fn-group" : "fn-group is-on-path"}>
              <em>{text(lang, "connection")} · agent-kit</em>
              {CONNECTION_FNS.map((name) => (
                <button
                  key={name}
                  type="button"
                  data-node={`fn:${name}`}
                  className={path.fn === name ? "is-active" : undefined}
                  aria-pressed={path.fn === name}
                  {...bind(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <div data-node="collab" className={path.collab ? "fn-group collab is-on-path" : "fn-group collab"}>
              <em>{text(lang, "coordination")} · agent-kit-collab</em>
              {COORDINATION_FNS.map((name) => (
                <button
                  key={name}
                  type="button"
                  data-node={`fn:${name}`}
                  className={path.fn === name ? "is-active" : undefined}
                  aria-pressed={path.fn === name}
                  {...bind(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="tier providers">
          <b>{text(lang, "providersLabel")}</b>
          <div className="row">
            {support.map((row) => {
              const onPath = !path.collab && row.id === path.providerId;
              const supported = providerSupportsLayerFn(row, path.fn);
              const unsupported = !path.collab && !supported;
              const className = onPath ? "is-lit" : unsupported ? "is-unsupported" : "is-idle";
              return (
                <button
                  key={row.id}
                  type="button"
                  data-node={`provider:${row.id}`}
                  className={className}
                  aria-pressed={onPath}
                  {...bind(row.id)}
                >
                  {row.id}
                  {unsupported ? " –" : null}
                </button>
              );
            })}
            <span className="yours">{text(lang, "yourAgent")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
