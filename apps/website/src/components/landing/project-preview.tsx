import { cva } from "class-variance-authority";

const check = cva(
  "flex items-center gap-2 before:size-[0.9rem] before:flex-none before:rounded-[3px] before:border before:content-['']",
  {
    variants: {
      done: {
        true: "before:border-ink before:bg-ink before:shadow-[inset_0_0_0_2px_var(--card)]",
        false: "before:border-line-2 before:bg-card"
      }
    }
  }
);

// Inside a project card, paragraphs take the card's body text; only the sample note keeps its own size and colour.
export function ProjectPreview({
  variant,
  copy
}: {
  readonly variant: "profile" | "review";
  readonly copy: {
    readonly sampleData: string;
    readonly presenceName: string;
    readonly presenceSig: string;
    readonly presenceWorking: string;
    readonly presenceIdle: string;
    readonly presenceTokens: string;
    readonly loopTaskTitle: string;
    readonly stepReview: string;
    readonly agentLabel: string;
    readonly loopAgentName: string;
    readonly loopCheckTests: string;
    readonly loopCheckDiff: string;
    readonly loopCheckNotes: string;
    readonly loopPrChip: string;
  };
}) {
  if (variant === "profile") {
    return (
      <div className="mb-4 rounded-control bg-paper-2 px-3.5 py-3">
        <p className="mb-2.5 text-micro text-pretty text-muted-foreground zh:leading-[1.8] zh:[line-break:strict]">
          {copy.sampleData}
        </p>
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5">
          <span
            className="grid size-10 place-items-center rounded-full bg-card text-[0.95rem] leading-[normal] font-[650] text-ink"
            aria-hidden="true"
          >
            {copy.presenceName.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <strong className="block text-[0.95rem] leading-[1.3] font-[650] text-ink">{copy.presenceName}</strong>
            <p className="mb-3 text-body-sm text-pretty text-ink-2 zh:leading-[1.8] zh:[line-break:strict]">
              {copy.presenceSig}
            </p>
            <div className="grid gap-2 rounded-control bg-card px-3 py-2.5 shadow-card">
              <div className="flex items-center gap-2 text-[14px] leading-[1.3] text-ink">
                <i className="size-2 flex-none rounded-full bg-sage" />
                <span>{copy.presenceWorking}</span>
              </div>
              <div className="flex items-center gap-2 text-[14px] leading-[1.3] text-ink">
                <i className="size-2 flex-none rounded-full bg-line-2" />
                <span>{copy.presenceIdle}</span>
              </div>
              <p className="mb-3 text-body-sm text-pretty text-ink-2 zh:leading-[1.8] zh:[line-break:strict]">
                {copy.presenceTokens}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-control bg-paper-2 px-3.5 py-3">
      <p className="mb-2.5 text-micro text-pretty text-muted-foreground zh:leading-[1.8] zh:[line-break:strict]">
        {copy.sampleData}
      </p>
      <div>
        <h4 className="mb-2 text-[0.95rem] leading-[1.3] font-[650] text-ink">{copy.loopTaskTitle}</h4>
        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5 mb-3 text-body-sm text-pretty text-ink-2 zh:leading-[1.8] zh:[line-break:strict]">
          <span className="rounded-control bg-[color-mix(in_srgb,var(--color-honey)_28%,var(--card))] px-2 py-0.5 font-[650] text-ink">
            {copy.stepReview}
          </span>
          <strong className="font-[650] text-ink">
            {copy.agentLabel} {copy.loopAgentName}
          </strong>
        </p>
        <ul className="mb-3 grid gap-1.5 text-[14px] leading-[1.4] text-ink">
          <li className={check({ done: false })}>{copy.loopCheckTests}</li>
          <li className={check({ done: false })}>{copy.loopCheckDiff}</li>
          <li className={check({ done: true })}>{copy.loopCheckNotes}</li>
        </ul>
        <span className="inline-flex rounded-control bg-card px-2.5 py-1 font-mono text-ui font-[650] text-ink shadow-card">
          {copy.loopPrChip}
        </span>
      </div>
    </div>
  );
}
