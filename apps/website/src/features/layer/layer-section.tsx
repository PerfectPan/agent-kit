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

const TITLE: Record<Lang, string> = { en: "leading-[1.04] tracking-[-0.035em]", zh: "leading-[1.25] break-keep" };
const BODY: Record<Lang, string> = { en: "", zh: "[line-break:strict]" };
const TIER =
  "relative z-1 grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-x-5 gap-y-4 phone:grid-cols-[1fr] phone:gap-2";
const TIER_LABEL = "pt-2 text-right text-ui font-semibold text-muted phone:pt-0 phone:text-left";
const ROW = "flex flex-wrap gap-2";
const CHIP = "cursor-pointer rounded-control px-3 py-2 text-ink transition-[box-shadow] duration-200 ease-settle";
const TOOL_CHIP = "text-ui font-medium";
const PROVIDER_CHIP = "font-mono text-ui-sm";
const CHIP_IDLE = "bg-card ring-1 ring-line";
const CHIP_ON_PATH = "bg-card shadow-card ring-2 ring-honey/55";
// A provider that cannot run the focused function is drawn as an empty, dashed slot.
const CHIP_UNSUPPORTED = "border border-dashed border-line-2 bg-paper";
const FN_GROUP = "flex flex-wrap content-start gap-1.5 rounded-container bg-paper-2 p-3";
const FN_GROUP_IDLE = "ring-1 ring-line";
const FN_GROUP_ON_PATH = "ring-2 ring-ochre/55";
const FN_GROUP_LABEL = "mb-0.5 basis-full text-ui-sm font-semibold text-muted not-italic";
const FN =
  "cursor-pointer rounded-control px-2.25 py-1.25 font-mono text-ui-sm text-ink ring-1 ring-line transition-[color,background-color,box-shadow] duration-200 ease-settle";

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
        <h2
          className={`mb-2 text-left text-[length:clamp(2rem,3.2vw,3rem)] font-extrabold text-balance ${TITLE[lang]}`}
        >
          {text(lang, "layerTitle")}
        </h2>
        <p className={`mt-2.5 max-w-[62ch] text-left text-[17px] leading-[1.6] text-pretty text-ink-2 ${BODY[lang]}`}>
          {text(lang, "layerBody")}
        </p>
      </div>
      <div ref={ref} className="relative grid gap-8">
        <LayerDiagram points={segments} size={size} />
        <div className={TIER}>
          <b className={TIER_LABEL}>{text(lang, "yourTools")}</b>
          <ChipRow
            className={ROW}
            onFocusChange={onFocusChange}
            items={TOOL_IDS.map((tool) => ({
              id: tool,
              node: `tool:${tool}`,
              label: text(lang, TOOL_COPY[tool]),
              className: `${CHIP} ${TOOL_CHIP} ${path.tool === tool ? CHIP_ON_PATH : CHIP_IDLE}`,
              pressed: path.tool === tool
            }))}
          />
        </div>
        <div className={TIER}>
          <b className={TIER_LABEL}>{text(lang, "toolkit")}</b>
          <div className="grid grid-cols-[minmax(0,1.75fr)_minmax(12rem,1fr)] gap-x-4 gap-y-3 phone:grid-cols-[1fr]">
            <div className={`${FN_GROUP} ${path.collab ? FN_GROUP_IDLE : FN_GROUP_ON_PATH}`}>
              <em className={FN_GROUP_LABEL}>{text(lang, "connection")} · agent-kit</em>
              {CONNECTION_FNS.map((name) => (
                <button
                  key={name}
                  type="button"
                  data-node={`fn:${name}`}
                  className={`${FN} ${path.fn === name ? "bg-honey" : "bg-card"}`}
                  aria-pressed={path.fn === name}
                  {...bind(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <div data-node="collab" className={`${FN_GROUP} ${path.collab ? FN_GROUP_ON_PATH : FN_GROUP_IDLE}`}>
              <em className={FN_GROUP_LABEL}>{text(lang, "coordination")} · agent-kit-collab</em>
              {COORDINATION_FNS.map((name) => (
                <button
                  key={name}
                  type="button"
                  data-node={`fn:${name}`}
                  className={`${FN} ${path.fn === name ? "bg-honey" : "bg-card"}`}
                  aria-pressed={path.fn === name}
                  {...bind(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={TIER}>
          <b className={TIER_LABEL}>{text(lang, "providersLabel")}</b>
          <ChipRow
            className={ROW}
            onFocusChange={onFocusChange}
            items={support.map((row) => {
              const onPath = !path.collab && row.id === path.providerId;
              const unsupported = !path.collab && !providerSupportsLayerFn(row, path.fn);
              return {
                id: row.id,
                node: `provider:${row.id}`,
                label: row.id,
                suffix: unsupported ? " –" : null,
                className: `${CHIP} ${PROVIDER_CHIP} ${onPath ? CHIP_ON_PATH : unsupported ? CHIP_UNSUPPORTED : CHIP_IDLE}`,
                pressed: onPath
              };
            })}
          >
            <span className="rounded-control border border-dashed border-ink-2 bg-transparent px-3 py-2 font-sans text-ui-sm font-semibold text-ink">
              {text(lang, "yourAgent")}
            </span>
          </ChipRow>
        </div>
      </div>
    </section>
  );
}
