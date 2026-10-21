import { API } from "typescript/unstable/sync";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import {
  isArrayLiteralExpression,
  isIdentifier,
  isStringLiteral,
  isVariableStatement,
  ModifierFlags,
  NodeFlags,
  type Expression
} from "typescript/unstable/ast";

// Parse an isolated virtual file because configuration must never execute provider code, including illegal-import fixtures.
export function extractAgentMarkers(file: string, text: string): string[] {
  const files = createVirtualFileSystem({
    "/facts.ts": text,
    "/tsconfig.json": JSON.stringify({
      files: ["facts.ts"],
      compilerOptions: { noLib: true, noResolve: true, types: [] }
    })
  });
  const api = new API({ cwd: "/", fs: { ...files, readFile: (path) => files.readFile?.(path) ?? null } });
  const fail = (element: string, reason: string): never => {
    throw new Error(`${file}: ${element}: ${reason}`);
  };
  try {
    const program = api.updateSnapshot({ openProjects: ["/tsconfig.json"] }).getProject("/tsconfig.json")?.program;
    const source = program?.getSourceFile("/facts.ts");
    if (source === undefined) {
      return fail("agentMarkers", "could not parse facts source");
    }
    const diagnostic = program?.getSyntacticDiagnostics("/facts.ts")[0];
    if (diagnostic !== undefined) {
      return fail(`source at ${diagnostic.pos}`, diagnostic.text);
    }
    const constants = new Map<string, Expression | undefined>();
    for (const statement of source.statements) {
      if (
        isVariableStatement(statement) &&
        (statement.modifierFlags & ModifierFlags.Export) !== 0 &&
        (statement.declarationList.flags & NodeFlags.BlockScoped) === NodeFlags.Const
      ) {
        for (const declaration of statement.declarationList.declarations) {
          if (isIdentifier(declaration.name)) {
            if (constants.has(declaration.name.text)) {
              return fail(declaration.name.text, "duplicate exported const");
            }
            constants.set(declaration.name.text, declaration.initializer);
          }
        }
      }
    }
    const markers = constants.get("agentMarkers");
    if (markers === undefined || !isArrayLiteralExpression(markers)) {
      return fail("agentMarkers", "expected an exported const array literal");
    }
    return markers.elements.map((element, index) => {
      const value = isIdentifier(element) ? constants.get(element.text) : element;
      if (value !== undefined && isStringLiteral(value)) {
        return value.text;
      }
      return fail(
        `agentMarkers[${index}] (${element.getText(source) || "<empty>"})`,
        "expected a string literal or a same-file export const initialized with a string literal"
      );
    });
  } finally {
    api.close();
  }
}
