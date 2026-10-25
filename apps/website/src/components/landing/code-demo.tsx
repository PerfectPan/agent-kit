import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import {
  TASK_ORDER,
  changedFieldKeys,
  changedLineIndexes,
  demoView,
  initialSelection,
  isBlockedOutput,
  isSwapField,
  maxOutputFieldCount,
  nextAutoplayStep,
  nextTaskKey,
  selectAgent,
  selectTask,
  taskLabel,
  type Token
} from "../../lib/demo-state.ts";
import { text, type Lang } from "../../lib/landing-copy.ts";
import { landingFacts } from "virtual:landing-facts";
import { Mascot, type MascotState } from "../mascot.tsx";

const WORK_MS = 1200;
const LINE_MS = 50;
const BLOCKED_MS = 900;
const AUTOPLAY_IDLE_MS = 10_000;
const AUTOPLAY_STEP_MS = 5000;
const FLASH_MS = 200;

function tokenClass(token: Token): string | undefined {
  const names = [token.tone, token.swap ? "swap" : undefined].filter((name) => name !== undefined);
  return names.length > 0 ? names.join(" ") : undefined;
}

function lineClass(index: number, shown: number, flash: ReadonlySet<number>): string | undefined {
  const names = [index < shown ? undefined : "pending", flash.has(index) ? "flash" : undefined].filter(
    (name) => name !== undefined
  );
  return names.length > 0 ? names.join(" ") : undefined;
}

function fieldRowClass(key: string, flash: ReadonlySet<string>): string | undefined {
  const names = [isSwapField(key) ? "is-swap" : undefined, flash.has(key) ? "flash" : undefined].filter(
    (name) => name !== undefined
  );
  return names.length > 0 ? names.join(" ") : undefined;
}

function codeLines(lines: readonly (readonly Token[])[], shown: number, flash: ReadonlySet<number>, nonce: number) {
  return lines.map((line, index) => (
    <span key={`${nonce}-${index}`} className={lineClass(index, shown, flash)}>
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
  const [mascot, setMascot] = useState<MascotState>("idle");
  const [shown, setShown] = useState(view.output.length);
  const [paused, setPaused] = useState(false);
  const [raw, setRaw] = useState(false);
  const [hopNonce, setHopNonce] = useState(0);
  const [flashNonce, setFlashNonce] = useState(0);
  const [flashFields, setFlashFields] = useState<ReadonlySet<string>>(() => new Set());
  const [flashCode, setFlashCode] = useState<ReadonlySet<number>>(() => new Set());
  const [flashOutput, setFlashOutput] = useState<ReadonlySet<number>>(() => new Set());
  const [allowMotion, setAllowMotion] = useState(false);
  const firstSwitch = useRef(true);
  const lastUserAt = useRef(Date.now());
  const allowMotionRef = useRef(false);
  const prevFields = useRef(view.fields);
  const prevCode = useRef(view.code);
  const prevOutput = useRef(view.output);
  const fieldCount = maxOutputFieldCount();

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    function sync() {
      setAllowMotion(!query.matches);
    }
    sync();
    query.addEventListener("change", sync);
    return () => {
      query.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    allowMotionRef.current = allowMotion;
  }, [allowMotion]);

  useEffect(() => {
    const next = demoView(selection, support);
    const fields = changedFieldKeys(prevFields.current, next.fields);
    const code = changedLineIndexes(prevCode.current, next.code);
    const outputLines = changedLineIndexes(prevOutput.current, next.output);
    prevFields.current = next.fields;
    prevCode.current = next.code;
    prevOutput.current = next.output;
    const output = next.output;
    if (firstSwitch.current) {
      firstSwitch.current = false;
      setShown(output.length);
      setMascot("idle");
      return;
    }
    setFlashFields(new Set(fields));
    setFlashCode(new Set(code));
    setFlashOutput(new Set(outputLines));
    setFlashNonce((current) => current + 1);
    const flashTimer = window.setTimeout(() => {
      setFlashFields(new Set());
      setFlashCode(new Set());
      setFlashOutput(new Set());
    }, FLASH_MS);
    if (!allowMotionRef.current) {
      setShown(output.length);
      setMascot("idle");
      return () => {
        window.clearTimeout(flashTimer);
      };
    }
    setShown(0);
    setMascot("working");
    const timers: number[] = [];
    output.forEach((_, index) => {
      timers.push(window.setTimeout(() => setShown(index + 1), LINE_MS * (index + 1)));
    });
    const blocked = isBlockedOutput(output);
    timers.push(
      window.setTimeout(() => {
        setMascot(blocked ? "blocked" : "idle");
      }, WORK_MS)
    );
    if (blocked) {
      timers.push(window.setTimeout(() => setMascot("idle"), WORK_MS + BLOCKED_MS));
    }
    return () => {
      window.clearTimeout(flashTimer);
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [selection, support]);

  useEffect(() => {
    if (!allowMotion || paused) {
      return undefined;
    }
    const elapsed = Date.now() - lastUserAt.current;
    const delay = elapsed < AUTOPLAY_IDLE_MS ? AUTOPLAY_IDLE_MS - elapsed : AUTOPLAY_STEP_MS;
    const timer = window.setTimeout(() => {
      setSelection((current) => nextAutoplayStep(current, support));
    }, delay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [allowMotion, paused, selection, support]);

  function markUser() {
    lastUserAt.current = Date.now();
    setHopNonce((current) => current + 1);
  }

  function onTaskKey(event: KeyboardEvent<HTMLDivElement>) {
    const next = nextTaskKey(view.task, event.key);
    if (next === null) {
      return;
    }
    event.preventDefault();
    markUser();
    setSelection((current) => selectTask(current, next, support));
    document.getElementById(`task-${lang}-${next}`)?.focus();
  }

  return (
    <div
      className="demo"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setPaused(false);
        }
      }}
    >
      <Mascot state={mascot} hopSignal={hopNonce === 0 ? undefined : String(hopNonce)} className="m" />
      {mascot === "working" ? (
        <div key={`${selection.task}:${selection.agentId}`} className="feed" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      ) : null}
      <div className="window">
        <div className="tasks" role="tablist" aria-label={text(lang, "tasksLabel")} onKeyDown={onTaskKey}>
          {TASK_ORDER.map((task) => {
            const selected = view.task === task;
            return (
              <button
                key={task}
                type="button"
                role="tab"
                id={`task-${lang}-${task}`}
                aria-controls={`task-panel-${lang}`}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  markUser();
                  setSelection((current) => selectTask(current, task, support));
                }}
              >
                {text(lang, taskLabel(task))}
              </button>
            );
          })}
        </div>
        <div role="tabpanel" id={`task-panel-${lang}`} aria-labelledby={`task-${lang}-${view.task}`}>
          <div className="file">
            <span>{view.file}</span>
            <span>{view.packageName}</span>
          </div>
          <pre>{codeLines(view.code, view.code.length, flashCode, flashNonce)}</pre>
          <div className="result">
            <div className="file">
              <span>{text(lang, "outputLabel")}</span>
              <span className="output-toggle" role="group" aria-label={text(lang, "outputLabel")}>
                <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>
                  {text(lang, "outputFields")}
                </button>
                <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>
                  {text(lang, "outputRaw")}
                </button>
              </span>
            </div>
            <div className="result-body" style={{ "--output-rows": fieldCount } as CSSProperties}>
              <dl className={raw ? "fields is-hidden" : "fields"} aria-hidden={raw}>
                {view.fields.map((field) => (
                  <div key={`${flashNonce}-${field.key}`} className={fieldRowClass(field.key, flashFields)}>
                    <dt>{field.key}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
              <pre className={raw ? undefined : "is-hidden"} aria-hidden={!raw}>
                {codeLines(view.output, shown, flashOutput, flashNonce)}
              </pre>
            </div>
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
                  markUser();
                  setSelection((current) => selectAgent(current, agent.id, support));
                }}
              >
                {agent.mine ? "+ my-agent" : agent.id}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
