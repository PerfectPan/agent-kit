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
    <div className="section-head">
      <h2 id={id}>{title}</h2>
      <p className="sub">{body}</p>
    </div>
  );
}
