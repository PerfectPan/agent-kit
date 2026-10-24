import { useState, type KeyboardEvent } from "react";

import {
  TASK_ORDER,
  demoView,
  initialSelection,
  nextTaskKey,
  selectAgent,
  selectTask,
  taskLabel,
  type Token
} from "../../lib/demo-state.ts";
import { text, type Lang } from "../../lib/landing-copy.ts";
import { landingFacts } from "virtual:landing-facts";
import { Mascot } from "../mascot.tsx";

function tokenClass(token: Token): string | undefined {
  const names = [token.tone, token.swap ? "swap" : undefined].filter((name) => name !== undefined);
  return names.length > 0 ? names.join(" ") : undefined;
}

function codeLines(lines: readonly (readonly Token[])[]) {
  return lines.map((line, index) => (
    <span key={index}>
      {index > 0 ? "\n" : null}
      {line.map((token, tokenIndex) => (
        <span key={tokenIndex} className={tokenClass(token)}>
          {token.text}
        </span>
      ))}
    </span>
  ));
}

export function CodeDemo({ lang }: { readonly lang: Lang }) {
  const support = landingFacts.support;
  const [selection, setSelection] = useState(() => initialSelection(support));
  const view = demoView(selection, support);

  function onTaskKey(event: KeyboardEvent<HTMLDivElement>) {
    const next = nextTaskKey(view.task, event.key);
    if (next === null) {
      return;
    }
    event.preventDefault();
    setSelection((current) => selectTask(current, next, support));
    document.getElementById(`task-${next}`)?.focus();
  }

  return (
    <div className="demo">
      <Mascot state="idle" hopSignal={`${selection.task}:${selection.agentId}`} className="m" />
      <div className="window">
        <div className="tasks" role="tablist" aria-label={text(lang, "tasksLabel")} onKeyDown={onTaskKey}>
          {TASK_ORDER.map((task) => {
            const selected = view.task === task;
            return (
              <button
                key={task}
                type="button"
                role="tab"
                id={`task-${task}`}
                aria-controls="task-panel"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  setSelection((current) => selectTask(current, task, support));
                }}
              >
                {text(lang, taskLabel(task))}
              </button>
            );
          })}
        </div>
        <div role="tabpanel" id="task-panel" aria-labelledby={`task-${view.task}`}>
          <div className="file">
            <span>{view.file}</span>
            <span>{view.packageName}</span>
          </div>
          <pre>{codeLines(view.code)}</pre>
          <div className="result">
            <div className="file">
              <span>{text(lang, "outputLabel")}</span>
              <span>{text(lang, "sampleLabel")}</span>
            </div>
            <pre>{codeLines(view.output)}</pre>
          </div>
          <div className="agents">
            <span>{text(lang, "agentLabel")}</span>
            {view.agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={agent.mine ? "mine" : undefined}
                disabled={!agent.enabled}
                aria-pressed={agent.pressed}
                title={agent.enabled ? undefined : text(lang, "notSupportedYet")}
                onClick={() => {
                  setSelection((current) => selectAgent(current, agent.id, support));
                }}
              >
                {agent.mine ? "+ my-agent" : agent.id}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="caption">
        <b>{text(lang, "captionLead")}</b>
        {text(lang, "captionRest")}
      </p>
    </div>
  );
}
