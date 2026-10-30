const CHIP =
  "cursor-pointer rounded-control border px-3 py-1.25 font-mono text-ui-sm transition-[color,background-color,border-color] duration-200 ease-settle aria-pressed:bg-honey aria-pressed:text-ink disabled:cursor-not-allowed disabled:line-through disabled:opacity-35";
// The reader's own agent is drawn as an empty slot until it is picked.
const KIND = {
  listed: "border-code-edge bg-code-chip text-code-ink aria-pressed:border-honey",
  mine: "border-dashed border-honey bg-transparent text-honey aria-pressed:border-solid"
} as const;

export function AgentPicker({
  label,
  unsupportedLabel,
  agents,
  onSelect
}: {
  readonly label: string;
  readonly unsupportedLabel: string;
  readonly agents: readonly {
    readonly id: string;
    readonly label: string;
    readonly mine: boolean;
    readonly enabled: boolean;
    readonly pressed: boolean;
  }[];
  readonly onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 bg-code-bar px-4 py-3">
      <span className="mr-1.5 font-mono text-ui text-code-dim">{label}</span>
      {agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          className={`${CHIP} ${agent.mine ? KIND.mine : KIND.listed}`}
          disabled={!agent.enabled}
          aria-pressed={agent.pressed}
          title={agent.enabled ? undefined : unsupportedLabel}
          onClick={() => onSelect(agent.id)}
        >
          {agent.label}
        </button>
      ))}
    </div>
  );
}
