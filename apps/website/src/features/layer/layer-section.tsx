import { layerReducer } from "./layer-reducer.ts";
import { useElementRects } from "../../hooks/use-element-rects.ts";
import { ChipRow } from "../../components/landing/chip-row.tsx";
import { useMemo, useReducer } from "react";
import { landingFacts } from "virtual:landing-facts";

import {
  CONNECTION_FNS,
  COORDINATION_FNS,
  TOOL_IDS,
  providerSupportsLayerFn,
  resolveLayerPath,
  type ToolId
} from "./layer-paths.ts";
import { text, type CopyKey, type Lang } from "../landing/index.ts";
import { LayerDiagram } from "../../components/landing/layer-diagram.tsx";

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
  const [focus, dispatch] = useReducer(layerReducer, null);
  const path = resolveLayerPath(focus);
  const connections = useMemo(
    () => [
      {
        from: `[data-node="tool:${path.tool}"]`,
        to: `[data-node="fn:${path.fn}"]`,
        fromEdge: "bottom" as const,
        toEdge: "top" as const
      },
      {
        from: `[data-node="fn:${path.fn}"]`,
        to: path.collab ? '[data-node="collab"]' : `[data-node="provider:${path.providerId}"]`,
        fromEdge: "bottom" as const,
        toEdge: path.collab ? ("bottom" as const) : ("top" as const)
      }
    ],
    [path.tool, path.fn, path.providerId, path.collab]
  );
  const { ref, segments, size } = useElementRects(connections);
  const onFocusChange = (id: string | null) => dispatch({ type: "focus", id });

  function bind(id: string) {
    return {
      tabIndex: 0,
      onMouseEnter: () => onFocusChange(id),
      onMouseLeave: () => onFocusChange(null),
      onFocus: () => onFocusChange(id),
      onBlur: () => onFocusChange(null)
    };
  }

  return (
    <section className="layer reveal">
      <div className="layer-head">
        <h2>{text(lang, "layerTitle")}</h2>
        <p>{text(lang, "layerBody")}</p>
      </div>
      <div ref={ref} className="stack">
        <LayerDiagram points={segments} size={size} />
        <div className="tier">
          <b>{text(lang, "yourTools")}</b>
          <ChipRow
            className="row"
            onFocusChange={onFocusChange}
            items={TOOL_IDS.map((tool) => ({
              id: tool,
              node: `tool:${tool}`,
              label: text(lang, TOOL_COPY[tool]),
              className: path.tool === tool ? "is-hot" : "is-idle",
              pressed: path.tool === tool
            }))}
          />
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
          <ChipRow
            className="row"
            onFocusChange={onFocusChange}
            items={support.map((row) => {
              const onPath = !path.collab && row.id === path.providerId;
              const unsupported = !path.collab && !providerSupportsLayerFn(row, path.fn);
              return {
                id: row.id,
                node: `provider:${row.id}`,
                label: row.id,
                suffix: unsupported ? " –" : null,
                className: onPath ? "is-lit" : unsupported ? "is-unsupported" : "is-idle",
                pressed: onPath
              };
            })}
          >
            <span className="yours">{text(lang, "yourAgent")}</span>
          </ChipRow>
        </div>
      </div>
    </section>
  );
}
