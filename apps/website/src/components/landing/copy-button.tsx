import { cn } from "../../lib/utils.ts";

export function CopyButton({
  copied,
  label,
  title,
  onCopy
}: {
  readonly copied: boolean;
  readonly label: string;
  readonly title: string;
  readonly onCopy: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "cursor-pointer p-0 font-mono text-ui underline underline-offset-3",
        copied ? "text-ochre" : "text-ink-2"
      )}
      aria-label={title}
      onClick={onCopy}
    >
      {label}
    </button>
  );
}
