import { text, type Lang } from "../../lib/landing-copy.ts";

export function ProjectIllustration({
  id,
  lang
}: {
  readonly id: "agent-presence" | "agent-task-loop";
  readonly lang: Lang;
}) {
  if (id === "agent-presence") {
    return (
      <div className="illust presence">
        <p className="sample">{text(lang, "sampleData")}</p>
        <div className="profile">
          <span className="avatar" aria-hidden="true">
            {text(lang, "presenceName").slice(0, 1)}
          </span>
          <div className="profile-body">
            <strong>{text(lang, "presenceName")}</strong>
            <p className="sig-line">{text(lang, "presenceSig")}</p>
            <div className="sig-card">
              <div className="sig-row">
                <i className="sig-dot working" />
                <span>{text(lang, "presenceWorking")}</span>
              </div>
              <div className="sig-row">
                <i className="sig-dot idle" />
                <span>{text(lang, "presenceIdle")}</span>
              </div>
              <p className="sig-tokens">{text(lang, "presenceTokens")}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="illust loop">
      <p className="sample">{text(lang, "sampleData")}</p>
      <div className="review">
        <h4>{text(lang, "loopTaskTitle")}</h4>
        <p className="review-step">
          <span>{text(lang, "stepReview")}</span>
          <strong>
            {text(lang, "agentLabel")} {text(lang, "loopAgentName")}
          </strong>
        </p>
        <ul className="checklist">
          <li>{text(lang, "loopCheckTests")}</li>
          <li>{text(lang, "loopCheckDiff")}</li>
          <li className="is-done">{text(lang, "loopCheckNotes")}</li>
        </ul>
        <span className="pr-chip">{text(lang, "loopPrChip")}</span>
      </div>
    </div>
  );
}
