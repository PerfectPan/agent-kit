import type { ComponentProps } from "react";

/** A landing section that reveals on scroll: a heading and lead above the section's content. */
export function LandingSection({
  headingId,
  title,
  body,
  children,
  ...props
}: Omit<ComponentProps<"section">, "className" | "title"> & {
  readonly headingId?: string;
  readonly title: string;
  readonly body: string;
}) {
  return (
    <section className="reveal grid grid-cols-1 gap-y-5 pt-16" {...props}>
      <div>
        <h2 id={headingId} className="mb-2 text-left text-section tracking-[-0.03em] text-balance zh:break-keep">
          {title}
        </h2>
        <p className="max-w-read text-left text-body-sm text-ink-2">{body}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}
