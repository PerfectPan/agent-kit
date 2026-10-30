import { cn } from "../../lib/utils.ts";

export interface Token {
  readonly text: string;
  readonly tone?: "k" | "s" | "num" | "c";
  readonly swap?: boolean;
}

const TONE = { k: "text-code-k", s: "text-code-s", num: "text-code-n", c: "text-code-dim" } as const;

function tokenClass(token: Token, flash: boolean): string {
  if (token.swap) {
    // A swapped value stays at full strength in the plain code colour over its highlight.
    return cn("rounded-[4px] bg-honey/34 px-0.5 text-code-ink", flash && "motion-safe:animate-swap-in");
  }
  return cn("opacity-55", token.tone && TONE[token.tone]);
}

export function CodeView({
  lines,
  shown,
  flash,
  nonce
}: {
  readonly lines: readonly (readonly Token[])[];
  readonly shown: number;
  readonly flash: ReadonlySet<number>;
  readonly nonce: number;
}) {
  return lines.map((line, index) => (
    <span
      key={`${nonce}-${index}`}
      className={cn(
        "-mx-1 block min-h-[22px] rounded-[4px] px-1",
        index >= shown && "invisible",
        flash.has(index) && "motion-safe:animate-line-in"
      )}
    >
      {line.map((token, tokenIndex) => (
        <span key={tokenIndex} className={tokenClass(token, flash.has(index))}>
          {token.text}
        </span>
      ))}
    </span>
  ));
}
