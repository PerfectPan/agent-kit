export interface Token {
  readonly text: string;
  readonly tone?: "k" | "s" | "num" | "c";
  readonly swap?: boolean;
}

function tokenClass(token: Token): string | undefined {
  const names = [token.tone, token.swap ? "swap" : undefined].filter((name) => name !== undefined);
  return names.length > 0 ? names.join(" ") : undefined;
}

function lineClass(index: number, shown: number, flash: ReadonlySet<number>): string | undefined {
  const names = [index < shown ? undefined : "pending", flash.has(index) ? "flash" : undefined].filter(
    (name) => name !== undefined
  );
  return names.length > 0 ? names.join(" ") : undefined;
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
    <span key={`${nonce}-${index}`} className={lineClass(index, shown, flash)}>
      {line.map((token, tokenIndex) => (
        <span key={tokenIndex} className={tokenClass(token)}>
          {token.text}
        </span>
      ))}
    </span>
  ));
}
