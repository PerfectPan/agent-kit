import type { CopyKey } from "./landing-copy.ts";
import type { Capability, SupportRow } from "./support.ts";

export const MY_AGENT = "my-agent";

export const TASK_ORDER = ["detect", "hooks", "sessions", "usage", "drive", "coordinate"] as const;

export type TaskKey = (typeof TASK_ORDER)[number];

export interface DemoSelection {
  readonly task: TaskKey;
  readonly agentId: string;
}

export interface Token {
  readonly text: string;
  readonly tone?: "k" | "s" | "num" | "c";
  readonly swap?: boolean;
}

export interface DemoAgent {
  readonly id: string;
  readonly mine: boolean;
  readonly enabled: boolean;
  readonly pressed: boolean;
}

export interface DemoView {
  readonly task: TaskKey;
  readonly file: string;
  readonly packageName: string;
  readonly code: readonly (readonly Token[])[];
  readonly output: readonly (readonly Token[])[];
  readonly agents: readonly DemoAgent[];
}

interface TaskSpec {
  readonly key: TaskKey;
  readonly file: string;
  readonly packageName: string;
  readonly capability: Capability | null;
  readonly label: CopyKey;
}

const TASKS: readonly TaskSpec[] = [
  { key: "detect", file: "detect.ts", packageName: "@rivus/agent-kit", capability: "discovery", label: "taskDetect" },
  { key: "hooks", file: "hook.ts", packageName: "@rivus/agent-kit", capability: "hooks", label: "taskHooks" },
  {
    key: "sessions",
    file: "sessions.ts",
    packageName: "@rivus/agent-kit",
    capability: "sessions",
    label: "taskSessions"
  },
  { key: "usage", file: "usage.ts", packageName: "@rivus/agent-kit", capability: "usage", label: "taskUsage" },
  { key: "drive", file: "drive.ts", packageName: "@rivus/agent-kit", capability: "acp", label: "taskDrive" },
  {
    key: "coordinate",
    file: "coordinate.ts",
    packageName: "@rivus/agent-kit-collab",
    capability: null,
    label: "taskCoordinate"
  }
];

/** Native hook event for "a turn starts". The mockup checked these against the dialects. */
const TURN_START: Record<string, string> = {
  "my-agent": "turn.begin",
  "claude-code": "UserPromptSubmit",
  codex: "UserPromptSubmit",
  grok: "UserPromptSubmit",
  "gemini-cli": "BeforeAgent",
  opencode: "session.status",
  pi: "before_agent_start",
  cursor: "beforeSubmitPrompt"
};

const PROVIDER_FIELD: Record<Exclude<TaskKey, "coordinate">, string> = {
  detect: "discovery: myProbeRecipe",
  hooks: "hooks: myHookDialect",
  sessions: "sessions: mySessionAdapter",
  usage: "usage: myUsageDecoder",
  drive: "acp: myAcpProfile"
};

const k = (text: string): Token => ({ text, tone: "k" });
const s = (text: string, swap = false): Token => ({ text, tone: "s", swap });
const num = (text: string): Token => ({ text, tone: "num" });
const c = (text: string): Token => ({ text, tone: "c" });
const p = (text: string): Token => ({ text });
const w = (text: string): Token => ({ text, swap: true });

function taskSpec(task: TaskKey): TaskSpec {
  const spec = TASKS.find((item) => item.key === task);
  if (!spec) {
    throw new Error(`Unknown task ${task}`);
  }
  return spec;
}

export function taskLabel(task: TaskKey): CopyKey {
  return taskSpec(task).label;
}

export function agentSupports(row: SupportRow, task: TaskKey): boolean {
  const capability = taskSpec(task).capability;
  if (capability === null) {
    return true;
  }
  return row[capability];
}

export function isSelectable(agentId: string, task: TaskKey, rows: readonly SupportRow[]): boolean {
  if (agentId === MY_AGENT) {
    return true;
  }
  const row = rows.find((item) => item.id === agentId);
  return row !== undefined && agentSupports(row, task);
}

function fallbackAgent(task: TaskKey, rows: readonly SupportRow[]): string {
  return rows.find((row) => agentSupports(row, task))?.id ?? MY_AGENT;
}

export function initialSelection(rows: readonly SupportRow[]): DemoSelection {
  const task: TaskKey = "detect";
  return { task, agentId: fallbackAgent(task, rows) };
}

export function selectTask(selection: DemoSelection, task: TaskKey, rows: readonly SupportRow[]): DemoSelection {
  if (isSelectable(selection.agentId, task, rows)) {
    return { task, agentId: selection.agentId };
  }
  return { task, agentId: fallbackAgent(task, rows) };
}

/** Unsupported agents are ignored. The current agent stays. */
export function selectAgent(selection: DemoSelection, agentId: string, rows: readonly SupportRow[]): DemoSelection {
  if (!isSelectable(agentId, selection.task, rows)) {
    return selection;
  }
  return { task: selection.task, agentId };
}

export function nextTaskKey(current: TaskKey, key: string): TaskKey | null {
  const index = TASK_ORDER.indexOf(current);
  if (key === "ArrowRight" || key === "ArrowDown") {
    return TASK_ORDER[(index + 1) % TASK_ORDER.length] ?? current;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return TASK_ORDER[(index - 1 + TASK_ORDER.length) % TASK_ORDER.length] ?? current;
  }
  if (key === "Home") {
    return TASK_ORDER[0];
  }
  if (key === "End") {
    return TASK_ORDER[TASK_ORDER.length - 1] ?? current;
  }
  return null;
}

function quoted(agentId: string): Token {
  return s(`"${agentId}"`, true);
}

function providerLine(task: Exclude<TaskKey, "coordinate">): Token[] {
  return [k("const"), p(" myAgent = { id: "), s(`"${MY_AGENT}"`, true), p(", "), w(PROVIDER_FIELD[task]), p(" };")];
}

function withProvider(task: TaskKey, lines: Token[][]): Token[][] {
  if (task === "coordinate") {
    return lines;
  }
  const [first, ...rest] = lines;
  if (!first) {
    return lines;
  }
  return [first, providerLine(task), ...rest];
}

function importLine(names: string, from: string): Token[] {
  return [k("import"), p(` { ${names} } `), k("from"), p(" "), s(`"${from}"`), p(";")];
}

function hooksCode(agentId: string, mine: boolean): Token[][] {
  const call = mine
    ? [
        k("const"),
        p(" event = readHookEvent("),
        quoted(agentId),
        p(", payload, process.env, { "),
        w("providers: [myAgent]"),
        p(" });")
      ]
    : [k("const"), p(" event = readHookEvent("), quoted(agentId), p(", payload, process.env);")];
  const lines: Token[][] = [
    importLine("readHookEvent", "@rivus/agent-kit/harness/events"),
    [],
    [c("// in a hook command; the agent writes the payload to stdin")],
    call
  ];
  return mine ? withProvider("hooks", lines) : lines;
}

function hooksOutput(agentId: string): Token[][] {
  const native = TURN_START[agentId];
  if (native === undefined) {
    throw new Error(`No turn-start event for ${agentId}`);
  }
  return [
    [p("{ agent: "), quoted(agentId), p(", phase: "), s('"start"'), p(", scope: "), s('"turn"'), p(",")],
    [p("  nativeEvent: "), s(`"${native}"`), p(", sessionId, cwd }")]
  ];
}

function usageCode(agentId: string, mine: boolean): Token[][] {
  const call = mine
    ? [
        k("for await"),
        p(" ("),
        k("const"),
        p(" item "),
        k("of"),
        p(" scanUsage(platform, { agents: ["),
        quoted(agentId),
        p("], since: lastWeek, "),
        w("providers: [myAgent]"),
        p(" }))")
      ]
    : [
        k("for await"),
        p(" ("),
        k("const"),
        p(" item "),
        k("of"),
        p(" scanUsage(platform, { agents: ["),
        quoted(agentId),
        p("], since: lastWeek }))")
      ];
  const lines: Token[][] = [
    importLine("scanUsage, isUsageRecord", "@rivus/agent-kit/transcript/usage"),
    [],
    call,
    [p("  "), k("if"), p(" (isUsageRecord(item)) report(item);")]
  ];
  return mine ? withProvider("usage", lines) : lines;
}

function usageOutput(agentId: string): Token[][] {
  const granularity = agentId === "grok" ? "turn" : "request";
  return [
    [p("{ agent: "), quoted(agentId), p(", granularity: "), s(`"${granularity}"`), p(",")],
    [
      p("  usage: { inputTokens: "),
      num("18304"),
      p(", cacheReadTokens: "),
      num("16128"),
      p(", outputTokens: "),
      num("412"),
      p(" } }")
    ]
  ];
}

function sessionsCode(agentId: string, mine: boolean): Token[][] {
  const call = mine
    ? [
        k("for await"),
        p(" ("),
        k("const"),
        p(" item "),
        k("of"),
        p(" listSessions(platform, { agents: ["),
        quoted(agentId),
        p("], "),
        w("providers: [myAgent]"),
        p(" }))")
      ]
    : [
        k("for await"),
        p(" ("),
        k("const"),
        p(" item "),
        k("of"),
        p(" listSessions(platform, { agents: ["),
        quoted(agentId),
        p("] }))")
      ];
  const lines: Token[][] = [
    importLine("listSessions, isSessionHead", "@rivus/agent-kit/sessions"),
    [],
    call,
    [p("  "), k("if"), p(" (isSessionHead(item)) console.log(item.title);")]
  ];
  return mine ? withProvider("sessions", lines) : lines;
}

function sessionsOutput(agentId: string): Token[][] {
  return [
    [p("{ ref: { agent: "), quoted(agentId), p(", path }, title: "), s('"Fix the failing date test"'), p(", … }")],
    [c("// reads only the head and tail of each file")]
  ];
}

function driveCode(agentId: string, mine: boolean): Token[][] {
  const connect = mine
    ? [
        k("const"),
        p(" connection = "),
        k("yield*"),
        p(" connectAgent("),
        quoted(agentId),
        p(", { cwd, env, "),
        w("providers: [myAgent]"),
        p(" });")
      ]
    : [k("const"), p(" connection = "), k("yield*"), p(" connectAgent("), quoted(agentId), p(", { cwd, env });")];
  const lines: Token[][] = [
    importLine("connectAgent", "@rivus/agent-kit/acp"),
    [],
    connect,
    [k("const"), p(" session = "), k("yield*"), p(" connection.newSession({ sessionKey: "), s('"chat:42"'), p(" });")],
    [
      k("yield*"),
      p(" session.prompt([{ type: "),
      s('"text"'),
      p(", text: "),
      s('"Summarize README.md"'),
      p(" }]).pipe(Stream.runForEach(render));")
    ]
  ];
  return mine ? withProvider("drive", lines) : lines;
}

function driveOutput(): Token[][] {
  return [
    [p("{ type: "), s('"text-delta"'), p(", id, delta: "), s('"The README describes…"'), p(" }")],
    [p("{ type: "), s('"event"'), p(", event: { kind: "), s('"tool_call"'), p(", agentId, … } }")],
    [p("{ type: "), s('"finish"'), p(", id, finishReason: "), s('"stop"'), p(" }")]
  ];
}

function coordinateCode(agentId: string): Token[][] {
  return [
    importLine("createLeaseManager", "@rivus/agent-kit-collab/lease"),
    [],
    [c("// one Agent per task, across processes; a lost lease interrupts fenced work")],
    [
      k("const"),
      p(" leases = "),
      k("yield*"),
      p(" createLeaseManager({ ttlMs: "),
      num("60_000"),
      p(", heartbeatMs: "),
      num("15_000"),
      p(" });")
    ],
    [k("const"), p(" lease = "), k("yield*"), p(" leases.acquire("), s('"task:42"'), p(");")],
    [k("yield*"), p(" lease.runFenced((token) => runTurn("), quoted(agentId), p(", token));")]
  ];
}

function coordinateOutput(agentId: string): Token[][] {
  return [
    [c("worker A"), p("  acquired task:42 · fencing token "), num("7"), p(" · runs "), quoted(agentId)],
    [c("worker B"), p("  { _tag: "), s('"LeaseHeld"'), p(" }")]
  ];
}

function detectCode(agentId: string, mine: boolean): Token[][] {
  const call = mine
    ? [
        k("const"),
        p(" found = ("),
        k("await"),
        p(" detectAgents(platform, { "),
        w("providers: [myAgent]"),
        p(" })).find((i) => i.agent === "),
        quoted(agentId),
        p(");")
      ]
    : [
        k("const"),
        p(" found = ("),
        k("await"),
        p(" detectAgents(platform)).find((i) => i.agent === "),
        quoted(agentId),
        p(");")
      ];
  const lines: Token[][] = [importLine("detectAgents", "@rivus/agent-kit/discovery"), [], call];
  return mine ? withProvider("detect", lines) : lines;
}

function detectOutput(agentId: string): Token[][] {
  return [
    [
      p("{ agent: "),
      quoted(agentId),
      p(", status: "),
      s('"runnable"'),
      p(", version, auth: "),
      s('"logged-in"'),
      p(", evidence: [ … ] }")
    ]
  ];
}

function snippets(task: TaskKey, agentId: string): { code: Token[][]; output: Token[][] } {
  const mine = agentId === MY_AGENT;
  switch (task) {
    case "detect":
      return { code: detectCode(agentId, mine), output: detectOutput(agentId) };
    case "hooks":
      return { code: hooksCode(agentId, mine), output: hooksOutput(agentId) };
    case "sessions":
      return { code: sessionsCode(agentId, mine), output: sessionsOutput(agentId) };
    case "usage":
      return { code: usageCode(agentId, mine), output: usageOutput(agentId) };
    case "drive":
      return { code: driveCode(agentId, mine), output: driveOutput() };
    case "coordinate":
      return { code: coordinateCode(agentId), output: coordinateOutput(agentId) };
    default: {
      const exhaustive: never = task;
      throw new Error(`Unknown task ${String(exhaustive)}`);
    }
  }
}

export function plainText(lines: readonly (readonly Token[])[]): string {
  return lines.map((line) => line.map((token) => token.text).join("")).join("\n");
}

export function demoView(selection: DemoSelection, rows: readonly SupportRow[]): DemoView {
  const agentId = isSelectable(selection.agentId, selection.task, rows)
    ? selection.agentId
    : fallbackAgent(selection.task, rows);
  const spec = taskSpec(selection.task);
  const rendered = snippets(selection.task, agentId);
  const agents: DemoAgent[] = [
    ...rows.map((row) => ({
      id: row.id,
      mine: false,
      enabled: agentSupports(row, selection.task),
      pressed: row.id === agentId
    })),
    { id: MY_AGENT, mine: true, enabled: true, pressed: agentId === MY_AGENT }
  ];
  return {
    task: selection.task,
    file: spec.file,
    packageName: spec.packageName,
    code: rendered.code,
    output: rendered.output,
    agents
  };
}
