import { layerReducer } from "./layer-reducer.ts";
import { useElementRects } from "../../hooks/use-element-rects.ts";
import { ChipRow } from "../../components/landing/chip-row.tsx";
import { cva } from "class-variance-authority";
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
import { LayerTier } from "../../components/landing/layer-tier.tsx";
import { LayerFnGroup } from "../../components/landing/layer-fn-group.tsx";
import { cn } from "../../lib/utils.ts";

const TOOL_COPY: Record<ToolId, CopyKey> = {
  usage: "toolUsage",
  status: "toolStatus",
  hook: "toolHook",
  editor: "toolEditor",
  orchestrator: "toolOrchestrator",
  runner: "toolRunner",
  viewer: "toolViewer"
};

const TITLE: Record<Lang, string> = { en: "leading-[1.04] tracking-[-0.035em]", zh: "leading-[1.25] break-keep" };
const BODY: Record<Lang, string> = { en: "", zh: "[line-break:strict]" };
const layerChip = cva("cursor-pointer rounded-control px-3 py-2 text-ink transition-shadow duration-200 ease-settle", {
  variants: {
    kind: { tool: "text-ui font-medium", provider: "font-mono text-ui-sm" },
    state: {
      idle: "bg-card ring-1 ring-line",
      "on-path": "bg-card shadow-card ring-2 ring-honey/55",
      // A provider that cannot run the focused function is drawn as an empty, dashed slot.
      unsupported: "border border-dashed border-line-2 bg-paper"
    }
  }
});

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
    <section className="reveal pt-18">
      <div className="mb-7 max-w-read">
        <h2 className={cn("mb-2 text-left text-[clamp(2rem,3.2vw,3rem)] font-extrabold text-balance", TITLE[lang])}>
          {text(lang, "layerTitle")}
        </h2>
        <p className={cn("mt-2.5 max-w-[62ch] text-left text-[17px] leading-[1.6] text-pretty text-ink-2", BODY[lang])}>
          {text(lang, "layerBody")}
        </p>
      </div>
      <div ref={ref} className="relative grid gap-8">
        <LayerDiagram points={segments} size={size} />
        <LayerTier label={text(lang, "yourTools")}>
          <ChipRow
            className="flex flex-wrap gap-2"
            onFocusChange={onFocusChange}
            items={TOOL_IDS.map((tool) => ({
              id: tool,
              node: `tool:${tool}`,
              label: text(lang, TOOL_COPY[tool]),
              className: layerChip({ kind: "tool", state: path.tool === tool ? "on-path" : "idle" }),
              pressed: path.tool === tool
            }))}
          />
        </LayerTier>
        <LayerTier label={text(lang, "toolkit")}>
          <div className="grid grid-cols-[minmax(0,1.75fr)_minmax(12rem,1fr)] gap-x-4 gap-y-3 phone:grid-cols-[1fr]">
            <LayerFnGroup
              label={`${text(lang, "connection")} · agent-kit`}
              onPath={!path.collab}
              names={CONNECTION_FNS}
              focusedFn={path.fn}
              bind={bind}
            />
            <LayerFnGroup
              data-node="collab"
              label={`${text(lang, "coordination")} · agent-kit-collab`}
              onPath={path.collab}
              names={COORDINATION_FNS}
              focusedFn={path.fn}
              bind={bind}
            />
          </div>
        </LayerTier>
        <LayerTier label={text(lang, "providersLabel")}>
          <ChipRow
            className="flex flex-wrap gap-2"
            onFocusChange={onFocusChange}
            items={support.map((row) => {
              const onPath = !path.collab && row.id === path.providerId;
              const unsupported = !path.collab && !providerSupportsLayerFn(row, path.fn);
              return {
                id: row.id,
                node: `provider:${row.id}`,
                label: row.id,
                suffix: unsupported ? " –" : null,
                className: layerChip({
                  kind: "provider",
                  state: onPath ? "on-path" : unsupported ? "unsupported" : "idle"
                }),
                pressed: onPath
              };
            })}
          >
            <span className="rounded-control border border-dashed border-ink-2 bg-transparent px-3 py-2 font-sans text-ui-sm font-semibold text-ink">
              {text(lang, "yourAgent")}
            </span>
          </ChipRow>
        </LayerTier>
      </div>
    </section>
  );
}
