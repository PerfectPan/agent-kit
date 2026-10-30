export function SectionHeading({
  id,
  title,
  body
}: {
  readonly id?: string;
  readonly title: string;
  readonly body: string;
}) {
  return (
    <div>
      <h2 id={id} className="mb-2 text-left text-section tracking-[-0.03em] text-balance zh:break-keep">
        {title}
      </h2>
      <p className="max-w-read text-left text-secondary text-pretty text-ink-2 zh:[line-break:strict]">{body}</p>
    </div>
  );
}
