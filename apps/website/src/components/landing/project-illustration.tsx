import { text, type Lang } from "../../lib/landing-copy.ts";

const STEPS = ["stepExecute", "stepReview", "stepRework", "stepPr"] as const;

export function ProjectIllustration({
  id,
  lang
}: {
  readonly id: "agent-presence" | "agent-task-loop";
  readonly lang: Lang;
}) {
  if (id === "agent-presence") {
    return (
      <div className="illust presence" aria-hidden="true">
        <div className="sig">
          <span className="sig-bar" />
          <span className="sig-line" />
          <span className="sig-line short" />
          <span className="dots">
            <i className="dot d1" />
            <i className="dot d2" />
            <i className="dot d3" />
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="illust loop" aria-hidden="true">
      <ol>
        {STEPS.map((key) => (
          <li key={key}>{text(lang, key)}</li>
        ))}
      </ol>
    </div>
  );
}
