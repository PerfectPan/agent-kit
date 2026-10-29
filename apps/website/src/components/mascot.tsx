const BODY =
  "M76 52 L164 42 C190 40 208 56 208 78 V112 C208 124 200 132 188 132 C183 132 181 129 181 125 V107 C158 109 136 113 126 120 C121 124 120 128 120 131 C136 133 166 136 186 141 C200 144 208 152 208 166 V184 C208 198 196 208 182 208 H76 C60 208 48 196 48 180 V80 C48 64 60 54 76 52 Z";
const FLAP =
  "M120 131 C136 133 166 136 186 141 C200 144 208 152 208 166 V172 C188 180 160 184 136 182 C126 178 120 171 120 162 Z";

export type MascotState = "idle" | "working" | "blocked";

export function Mascot({
  state,
  hop,
  className
}: {
  readonly state: MascotState;
  readonly hop?: boolean;
  readonly className?: string;
}) {
  const classes = [state, hop ? "hop" : undefined, className].filter((name) => name !== undefined).join(" ");

  return (
    <svg className={classes} viewBox="40 34 176 182" aria-hidden="true">
      <g className="m-all">
        <path className="m-body" d={BODY} />
        <path className="m-flap" d={FLAP} />
        <circle className="m-eye" cx="74" cy="86" r="5" />
        <circle className="m-eye" cx="108" cy="86" r="5" />
        <path className="m-lid" d="M68 88 H80 M102 88 H114" />
      </g>
    </svg>
  );
}
