import { Button } from "../ui/button.tsx";

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
        <Button
          key={agent.id}
          type="button"
          variant={agent.mine ? "chip-slot" : "chip"}
          size="chip"
          disabled={!agent.enabled}
          aria-pressed={agent.pressed}
          title={agent.enabled ? undefined : unsupportedLabel}
          onClick={() => onSelect(agent.id)}
        >
          {agent.label}
        </Button>
      ))}
    </div>
  );
}
