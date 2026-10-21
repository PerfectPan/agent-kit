import { parseSync, type Expression } from "oxc-parser";

// Parse facts as text because configuration must never execute provider code, including illegal-import fixtures.
export function extractAgentMarkers(file: string, text: string): string[] {
  const fail = (element: string, reason: string): never => {
    throw new Error(`${file}: ${element}: ${reason}`);
  };
  const parsed = parseSync(file, text);
  const diagnostic = parsed.errors[0];
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
