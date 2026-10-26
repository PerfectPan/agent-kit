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
    <button type="button" className={copied ? "copy is-copied" : "copy"} aria-label={title} onClick={onCopy}>
      {label}
    </button>
  );
}
