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
    <div className="agents">
      <span>{label}</span>
      {agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          className={agent.mine ? "mine" : undefined}
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
