import { parseSync, type Expression } from "oxc-parser";

// Parse facts as text because configuration must never execute provider code, including illegal-import fixtures.
export function extractAgentMarkers(file: string, text: string): string[] {
  const fail = (element: string, reason: string): never => {
    throw new Error(`${file}: ${element}: ${reason}`);
  };
  let source = text;
  let parsed = parseSync(file, source);
  // Oxc rejects exported resources before returning an AST. Treat them as mutable bindings so marker errors stay specific.
  while (parsed.errors[0]?.message === "Using declarations cannot be exported directly.") {
    const span = parsed.errors[0].labels[0];
    if (span === undefined) {
      return fail("source at 0", parsed.errors[0].message);
    }
    source = `${source.slice(0, span.start)}${"let _".padEnd(span.end - span.start)}${source.slice(span.end)}`;
    parsed = parseSync(file, source);
  }
  // Uninitialized constants cannot supply markers; diagnose them through the same declaration/element checks.
  const diagnostic = parsed.errors.find((error) => error.message !== "Missing initializer in const declaration");
  if (diagnostic !== undefined) {
    return fail(`source at ${diagnostic.labels[0]?.start ?? 0}`, diagnostic.message);
  }
  const constants = new Map<string, Expression | null>();
  for (const statement of parsed.program.body) {
    if (
      statement.type === "ExportNamedDeclaration" &&
      statement.declaration?.type === "VariableDeclaration" &&
      statement.declaration.kind === "const"
    ) {
      for (const declaration of statement.declaration.declarations) {
        if (declaration.id.type === "Identifier") {
          if (constants.has(declaration.id.name)) {
            return fail(declaration.id.name, "duplicate exported const");
          }
          constants.set(declaration.id.name, declaration.init);
        }
      }
    }
  }
  const markers = constants.get("agentMarkers");
  if (markers?.type !== "ArrayExpression") {
    return fail("agentMarkers", "expected an exported const array literal");
  }
  return markers.elements.map((element, index) => {
    const value = element?.type === "Identifier" ? constants.get(element.name) : element;
    if (value?.type === "Literal" && typeof value.value === "string") {
      return value.value;
    }
    return fail(
      `agentMarkers[${index}] (${element === null ? "<empty>" : text.slice(element.start, element.end)})`,
      "expected a string literal or a same-file export const initialized with a string literal"
    );
  });
}
