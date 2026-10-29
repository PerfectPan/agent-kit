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
      <div className="illust presence">
        <p className="sample">{copy.sampleData}</p>
        <div className="profile">
          <span className="avatar" aria-hidden="true">
            {copy.presenceName.slice(0, 1)}
          </span>
          <div className="profile-body">
            <strong>{copy.presenceName}</strong>
            <p className="sig-line">{copy.presenceSig}</p>
            <div className="sig-card">
              <div className="sig-row">
                <i className="sig-dot working" />
                <span>{copy.presenceWorking}</span>
              </div>
              <div className="sig-row">
                <i className="sig-dot idle" />
                <span>{copy.presenceIdle}</span>
              </div>
              <p className="sig-tokens">{copy.presenceTokens}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="illust loop">
      <p className="sample">{copy.sampleData}</p>
      <div className="review">
        <h4>{copy.loopTaskTitle}</h4>
        <p className="review-step">
          <span>{copy.stepReview}</span>
          <strong>
            {copy.agentLabel} {copy.loopAgentName}
          </strong>
        </p>
        <ul className="checklist">
          <li>{copy.loopCheckTests}</li>
          <li>{copy.loopCheckDiff}</li>
          <li className="is-done">{copy.loopCheckNotes}</li>
        </ul>
        <span className="pr-chip">{copy.loopPrChip}</span>
      </div>
    </div>
  );
}
