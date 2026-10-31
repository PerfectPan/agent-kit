import { cn } from "../lib/utils.ts";

const BODY =
  "M76 52 L164 42 C190 40 208 56 208 78 V112 C208 124 200 132 188 132 C183 132 181 129 181 125 V107 C158 109 136 113 126 120 C121 124 120 128 120 131 C136 133 166 136 186 141 C200 144 208 152 208 166 V184 C208 198 196 208 182 208 H76 C60 208 48 196 48 180 V80 C48 64 60 54 76 52 Z";
const FLAP =
  "M120 131 C136 133 166 136 186 141 C200 144 208 152 208 166 V172 C188 180 160 184 136 182 C126 178 120 171 120 162 Z";

export type MascotState = "idle" | "working" | "blocked";

function bodyMotion(state: MascotState, hop: boolean | undefined, quiet: boolean | undefined): string {
  if (quiet) {
    return "motion-safe:group-hover/brand:animate-hop-sm";
  }
  if (state === "working") {
    return "motion-safe:animate-bob";
  }
  if (state === "blocked") {
    return "motion-safe:animate-shake";
  }
  return cn(hop && "motion-safe:animate-hop", "motion-safe:group-hover/brand:animate-hop-hover");
}

function eyeStyle(state: MascotState, quiet: boolean | undefined): string {
  if (state === "blocked") {
    return "opacity-0";
  }
  if (quiet) {
    return "";
  }
  return state === "working" ? "motion-safe:animate-blink-fast" : "motion-safe:animate-blink";
}

/**
 * The mascot hops when an ancestor marked `group/brand` is hovered. A `quiet` mascot, as in the docs sidebar, skips
 * the state motion and hops lower.
 */
export function Mascot({
  state,
  hop,
  quiet,
  className
}: {
  readonly state: MascotState;
  readonly hop?: boolean;
  readonly quiet?: boolean;
  readonly className?: string;
}) {
  const blocked = state === "blocked";
  const eye = cn("origin-center fill-white transform-fill", eyeStyle(state, quiet));

  return (
    <svg className={cn("overflow-visible", className)} viewBox="40 34 176 182" aria-hidden="true">
      <g className={cn("origin-bottom transform-fill", bodyMotion(state, hop, quiet))}>
        <path
          className={blocked ? "fill-[color-mix(in_srgb,var(--color-ochre)_82%,#6b6b6b)]" : "fill-ochre"}
          d={BODY}
        />
        <path
          className={cn(
            "fill-honey transform-fill",
            state === "working" && !quiet && "motion-safe:origin-top-left motion-safe:animate-flap"
          )}
          d={FLAP}
        />
        <circle className={eye} cx="74" cy="86" r="5" />
        <circle className={eye} cx="108" cy="86" r="5" />
        <path
          className={cn("stroke-white stroke-6 [stroke-linecap:round]", blocked ? "opacity-100" : "opacity-0")}
          d="M68 88 H80 M102 88 H114"
        />
      </g>
    </svg>
  );
}
