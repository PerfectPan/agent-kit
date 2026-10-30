import { useReducer, type CSSProperties } from "react";
import { landingFacts } from "virtual:landing-facts";

import { text, type Lang } from "../landing/index.ts";
import { TASK_ORDER, demoView, isSwapField, maxCodeLineCount, maxOutputFieldCount, taskLabel } from "./snippets.ts";
import { demoReducer, demoSequence, initialDemoState } from "./demo-reducer.ts";
import { useAutoplay } from "../../hooks/use-autoplay.ts";
import { useAnimationRestart } from "../../hooks/use-animation-restart.ts";
import { useReducedMotion } from "../../hooks/use-reduced-motion.ts";
import { useTimedEvents } from "../../hooks/use-timed-events.ts";
import { useSelectedIndicator } from "../../hooks/use-selected-indicator.ts";
import { Mascot } from "../../components/mascot.tsx";
import { TaskTabs } from "../../components/landing/task-tabs.tsx";
import { CodeWindow } from "../../components/landing/code-window.tsx";
import { CodeView } from "../../components/landing/code-view.tsx";
import { OutputFields } from "../../components/landing/output-fields.tsx";
import { AgentPicker } from "../../components/landing/agent-picker.tsx";

export function DemoSection({ lang }: { readonly lang: Lang }) {
  const support = landingFacts.support;
  const [state, dispatch] = useReducer(demoReducer, support, initialDemoState);
  const view = demoView(state.selection, support);
  const allowMotion = !useReducedMotion();
  const tabsRef = useSelectedIndicator(view.task);
  const hop = useAnimationRestart(state.hopNonce === 0 ? undefined : String(state.hopNonce));
  useTimedEvents(state.selection, () => demoSequence(view, allowMotion), dispatch);
  const { markUser, interactionProps } = useAutoplay({
    enabled: allowMotion,
    stepKey: state.selection,
    idleMs: 10_000,
    intervalMs: 5000,
    onStep: () => dispatch({ type: "autoplay", rows: support })
  });

  return (
    <div className="relative mt-2 pt-22 text-left phone:pt-15 xl:mt-0" {...interactionProps}>
      <Mascot
        state={state.phase}
        hop={hop}
        className="absolute top-0 right-4 z-3 size-26 phone:right-2 phone:size-18 motion-safe:animate-pop"
      />
      <CodeWindow
        tabs={
          <TaskTabs
            lang={lang}
            label={text(lang, "tasksLabel")}
            items={TASK_ORDER.map((task) => ({ id: task, label: text(lang, taskLabel(task)) }))}
            listRef={tabsRef}
          />
        }
        value={view.task}
        onValueChange={(value) => {
          const task = TASK_ORDER.find((key) => key === value);
          if (task !== undefined) {
            markUser();
            dispatch({ type: "task", task, rows: support });
          }
        }}
        panelId={`task-panel-${lang}`}
        tabId={`task-${lang}-${view.task}`}
        file={view.file}
        packageName={view.packageName}
      >
        {/* Every task gets the height of the longest one, so switching tabs does not move the hero. */}
        <pre
          className="min-h-[calc(var(--code-rows)*22px+30px)] overflow-x-auto px-5.5 pt-3 pb-4.5 font-mono text-code text-code-dim [font-variant-ligatures:none]"
          style={{ "--code-rows": maxCodeLineCount() } as CSSProperties}
        >
          <CodeView lines={view.code} shown={view.code.length} flash={state.flashCode} nonce={state.flashNonce} />
        </pre>
        <OutputFields
          label={text(lang, "outputLabel")}
          fieldsLabel={text(lang, "outputFields")}
          rawLabel={text(lang, "outputRaw")}
          raw={state.raw}
          onRawChange={(value) => dispatch({ type: "raw", value })}
          fieldCount={maxOutputFieldCount()}
          fields={view.fields.map((field) => ({
            ...field,
            swap: isSwapField(field.key),
            flash: state.flashFields.has(field.key)
          }))}
          output={view.output}
          shown={state.shown}
          flashOutput={state.flashOutput}
          flashNonce={state.flashNonce}
        />
        <AgentPicker
          label={text(lang, "agentLabel")}
          unsupportedLabel={text(lang, "notSupportedYet")}
          agents={view.agents.map((agent) => ({ ...agent, label: agent.mine ? "+ my-agent" : agent.id }))}
          onSelect={(agentId) => {
            markUser();
            dispatch({ type: "agent", agentId, rows: support });
          }}
        />
      </CodeWindow>
    </div>
  );
}
