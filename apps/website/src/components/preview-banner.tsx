export function PreviewBanner({ label }: { label: string }) {
  return (
    <aside className="preview-banner" aria-label="Pull request preview">
      {label}
    </aside>
  );
}
