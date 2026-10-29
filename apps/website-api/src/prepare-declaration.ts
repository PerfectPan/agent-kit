import { resolve } from "node:path";

import ts from "typescript";

// This package's `typescript` dependency is the compiler API (catalog `typescript6`).
// Catalog TypeScript 7 only exports a version from its package root.

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface ParameterRef {
  readonly fn: string;
  readonly index: number;
}

function propertyName(property: ts.PropertySignature): string {
  const name = property.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  throw new Error("Options property has a computed name");
}

function formatProperty(property: ts.PropertySignature, file: ts.SourceFile): string {
  const docs = ts
    .getJSDocCommentsAndTags(property)
    .filter((tag) => ts.isJSDoc(tag))
    .map((tag) => tag.getText(file));
  let signature = property.getText(file).trim();
  if (!signature.endsWith(";")) {
    signature += ";";
  }
  const text = docs.length > 0 ? `${docs.join("\n")}\n${signature}` : signature;
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function leadingDoc(node: ts.Node, file: ts.SourceFile): string | undefined {
  const docs = ts
    .getJSDocCommentsAndTags(node)
    .filter((tag) => ts.isJSDoc(tag))
    .map((tag) => tag.getText(file));
  return docs.length > 0 ? docs.join("\n") : undefined;
}

function isExported(node: ts.Declaration): boolean {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

function applyEdits(source: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let next = source;
  let floor = source.length;
  for (const edit of ordered) {
    if (edit.end > floor) {
      throw new Error("Overlapping edits while preparing a declaration entry");
    }
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
    floor = edit.start;
  }
  return next;
}

function ensureProviderName(source: string): string {
  if (!/\bProvider\b/.test(source)) {
    return source;
  }
  if (/\b(?:interface|type|class)\s+Provider\b/.test(source) || /\bas Provider\b/.test(source)) {
    return source;
  }
  const match = /import\s*\{([^}]+)\}\s*from\s*"([^"]*types-[^"]+\.js)"/.exec(source);
  if (!match) {
    throw new Error("Prepared declaration names Provider, but this entry does not import it or declare it");
  }
  const specifiers = match[1] ?? "";
  const from = match[2] ?? "";
  const replaced = `import { t as Provider,${specifiers}} from "${from}"`;
  return source.slice(0, match.index) + replaced + source.slice(match.index + match[0].length);
}

function optionsInterfaceName(functionName: string): string {
  return `${functionName.slice(0, 1).toUpperCase()}${functionName.slice(1)}Options`;
}

function parametersRef(type: ts.TypeNode): ParameterRef | undefined {
  if (!ts.isIndexedAccessTypeNode(type) || !ts.isTypeReferenceNode(type.objectType)) {
    return undefined;
  }
  if (!ts.isIdentifier(type.objectType.typeName) || type.objectType.typeName.text !== "Parameters") {
    return undefined;
  }
  const query = type.objectType.typeArguments?.[0];
  if (!query || !ts.isTypeQueryNode(query) || !ts.isIdentifier(query.exprName)) {
    return undefined;
  }
  if (!ts.isLiteralTypeNode(type.indexType) || !ts.isNumericLiteral(type.indexType.literal)) {
    return undefined;
  }
  return { fn: query.exprName.text, index: Number(type.indexType.literal.text) };
}

function providerOptionsRef(type: ts.TypeNode): ParameterRef | undefined {
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName) || type.typeName.text !== "ProviderOptions") {
    return undefined;
  }
  const argument = type.typeArguments?.[0];
  if (!argument) {
    return undefined;
  }
  return parametersRef(argument);
}

function isInlineOptions(parameter: ts.ParameterDeclaration): boolean {
  if (!parameter.type || !ts.isIdentifier(parameter.name) || parameter.name.text !== "options") {
    return false;
  }
  return providerOptionsRef(parameter.type) !== undefined || ts.isTypeLiteralNode(parameter.type);
}

function referencedName(type: ts.TypeNode): string | undefined {
  if (ts.isIdentifier(type)) {
    return type.text;
  }
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    return type.typeName.text;
  }
  return undefined;
}

function literalNames(type: ts.TypeNode, file: ts.SourceFile): string[] {
  if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) {
    return [type.literal.text];
  }
  if (ts.isUnionTypeNode(type)) {
    return type.types.flatMap((part) => literalNames(part, file));
  }
  throw new Error(`Cannot read an Omit key from ${type.getText(file)}`);
}

function dedupe(properties: readonly ts.PropertySignature[]): ts.PropertySignature[] {
  const index = new Map<string, number>();
  const result: ts.PropertySignature[] = [];
  for (const property of properties) {
    const name = propertyName(property);
    const existing = index.get(name);
    if (existing === undefined) {
      index.set(name, result.length);
      result.push(property);
    } else {
      result[existing] = property;
    }
  }
  return result;
}

function propertiesOf(
  name: string,
  interfaces: ReadonlyMap<string, ts.InterfaceDeclaration>,
  seen: Set<string> = new Set()
): ts.PropertySignature[] {
  if (seen.has(name)) {
    return [];
  }
  seen.add(name);
  const declaration = interfaces.get(name);
  if (!declaration) {
    throw new Error(`No interface ${name} in this entry declaration`);
  }
  const collected: ts.PropertySignature[] = [];
  for (const clause of declaration.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
      continue;
    }
    for (const parent of clause.types) {
      if (!ts.isIdentifier(parent.expression)) {
        throw new Error(`${name} extends ${parent.getText()}, which is not a name in this file`);
      }
      collected.push(...propertiesOf(parent.expression.text, interfaces, seen));
    }
  }
  for (const member of declaration.members) {
    if (!ts.isPropertySignature(member)) {
      throw new Error(`${name} has a member that is not a property`);
    }
    collected.push(member);
  }
  return dedupe(collected);
}

function propertiesLiteral(properties: readonly ts.PropertySignature[], file: ts.SourceFile): string {
  const lines = properties.map((property) => formatProperty(property, file));
  return `{\n${lines.join("\n")}\n}`;
}

function typeLiteralBody(type: ts.TypeLiteralNode, file: ts.SourceFile): string {
  const lines = type.members.map((member) => {
    if (!ts.isPropertySignature(member)) {
      throw new Error(`Options type has a member that is not a property: ${member.getText(file)}`);
    }
    return formatProperty(member, file);
  });
  return `{\n${lines.join("\n")}\n}`;
}

function containsUnion(
  type: ts.TypeNode,
  aliases: ReadonlyMap<string, ts.TypeAliasDeclaration>,
  seen = new Set<string>()
): boolean {
  if (ts.isParenthesizedTypeNode(type)) {
    return containsUnion(type.type, aliases, seen);
  }
  if (ts.isUnionTypeNode(type)) {
    return true;
  }
  if (ts.isIntersectionTypeNode(type)) {
    return type.types.some((part) => containsUnion(part, aliases, seen));
  }
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === "Omit") {
    const target = type.typeArguments?.[0];
    return target !== undefined && containsUnion(target, aliases, seen);
  }
  const name = referencedName(type);
  if (name === undefined || seen.has(name)) {
    return false;
  }
  seen.add(name);
  const alias = aliases.get(name);
  return alias !== undefined && containsUnion(alias.type, aliases, seen);
}

function renderPart(
  type: ts.TypeNode,
  interfaces: ReadonlyMap<string, ts.InterfaceDeclaration>,
  aliases: ReadonlyMap<string, ts.TypeAliasDeclaration>,
  file: ts.SourceFile
): string {
  if (ts.isParenthesizedTypeNode(type)) {
    return renderPart(type.type, interfaces, aliases, file);
  }
  const name = referencedName(type);
  if (name !== undefined && !(ts.isTypeReferenceNode(type) && type.typeArguments !== undefined)) {
    const alias = aliases.get(name);
    if (alias) {
      return renderPart(alias.type, interfaces, aliases, file);
    }
    return propertiesLiteral(
      propertiesOf(name, interfaces).filter((property) => propertyName(property) !== "providers"),
      file
    );
  }
  if (ts.isIntersectionTypeNode(type)) {
    return type.types.map((part) => renderPart(part, interfaces, aliases, file)).join(" & ");
  }
  if (ts.isUnionTypeNode(type)) {
    return `(${type.types.map((part) => renderPart(part, interfaces, aliases, file)).join(" | ")})`;
  }
  if (ts.isTypeLiteralNode(type)) {
    return propertiesLiteral(
      type.members.flatMap((member) => {
        if (!ts.isPropertySignature(member)) {
          throw new Error(`Options type has a member that is not a property: ${member.getText(file)}`);
        }
        return propertyName(member) === "providers" ? [] : [member];
      }),
      file
    );
  }
  throw new Error(`Cannot render options type ${type.getText(file)}`);
}

function expandType(
  type: ts.TypeNode,
  interfaces: ReadonlyMap<string, ts.InterfaceDeclaration>,
  aliases: ReadonlyMap<string, ts.TypeAliasDeclaration>,
  file: ts.SourceFile
): ts.PropertySignature[] {
  if (ts.isParenthesizedTypeNode(type)) {
    return expandType(type.type, interfaces, aliases, file);
  }
  const name = referencedName(type);
  if (name !== undefined && !(ts.isTypeReferenceNode(type) && type.typeArguments !== undefined)) {
    const alias = aliases.get(name);
    if (alias) {
      return expandType(alias.type, interfaces, aliases, file);
    }
    return propertiesOf(name, interfaces);
  }
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === "Omit") {
    const target = type.typeArguments?.[0];
    const keys = type.typeArguments?.[1];
    if (!target || !keys) {
      throw new Error(`Omit type is missing arguments: ${type.getText(file)}`);
    }
    const omitted = new Set(literalNames(keys, file));
    return expandType(target, interfaces, aliases, file).filter((property) => !omitted.has(propertyName(property)));
  }
  if (ts.isIntersectionTypeNode(type)) {
    return dedupe(type.types.flatMap((part) => expandType(part, interfaces, aliases, file)));
  }
  if (ts.isTypeLiteralNode(type)) {
    return type.members.map((member) => {
      if (!ts.isPropertySignature(member)) {
        throw new Error(`Options type has a member that is not a property: ${member.getText(file)}`);
      }
      return member;
    });
  }
  throw new Error(`Cannot expand options type ${type.getText(file)}`);
}

function referencedParameterType(
  ref: ParameterRef,
  functions: ReadonlyMap<string, ts.FunctionDeclaration>
): ts.TypeNode {
  const declaration = functions.get(ref.fn);
  const parameter = declaration?.parameters[ref.index];
  if (!declaration || !parameter?.type) {
    throw new Error(`${ref.fn} has no parameter ${ref.index}`);
  }
  return parameter.type;
}

function optionsExport(
  name: string,
  ref: ParameterRef,
  functions: ReadonlyMap<string, ts.FunctionDeclaration>,
  interfaces: ReadonlyMap<string, ts.InterfaceDeclaration>,
  aliases: ReadonlyMap<string, ts.TypeAliasDeclaration>,
  file: ts.SourceFile
): string {
  const type = referencedParameterType(ref, functions);
  if (containsUnion(type, aliases)) {
    return `export type ${name} = ${renderPart(type, interfaces, aliases, file)} & {\n  readonly providers?: readonly Provider[];\n}`;
  }
  const properties = expandType(type, interfaces, aliases, file).filter(
    (property) => propertyName(property) !== "providers"
  );
  const lines = properties.map((property) => formatProperty(property, file));
  lines.push("  readonly providers?: readonly Provider[];");
  return `export interface ${name} {\n${lines.join("\n")}\n}`;
}

function functionPrefix(
  statement: ts.FunctionDeclaration,
  name: string,
  functions: ReadonlyMap<string, ts.FunctionDeclaration>,
  interfaces: ReadonlyMap<string, ts.InterfaceDeclaration>,
  aliases: ReadonlyMap<string, ts.TypeAliasDeclaration>,
  names: ReadonlySet<string>,
  file: ts.SourceFile
): string | undefined {
  const parts: string[] = [];
  for (const parameter of statement.parameters) {
    if (!parameter.type || !isInlineOptions(parameter) || names.has(optionsInterfaceName(name))) {
      continue;
    }
    const interfaceName = optionsInterfaceName(name);
    const ref = providerOptionsRef(parameter.type);
    if (ref) {
      parts.push(`${optionsExport(interfaceName, ref, functions, interfaces, aliases, file)}\n`);
    } else if (ts.isTypeLiteralNode(parameter.type)) {
      parts.push(`export interface ${interfaceName} ${typeLiteralBody(parameter.type, file)}\n`);
    }
  }
  const inner = functions.get(`${name}$1`);
  if (inner && leadingDoc(statement, file) === undefined) {
    const doc = leadingDoc(inner, file);
    if (doc !== undefined) {
      parts.push(`${doc}\n`);
    }
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

/** Point relative declaration imports at the original `dist` file so a copied entry still resolves. */
export function absolutizeRelativeImports(source: string, fromDirectory: string): string {
  return source.replaceAll(/from "(\.[^"]+)"/g, (_full, specifier: string) => {
    return `from ${JSON.stringify(resolve(fromDirectory, specifier))}`;
  });
}

/**
 * The declaration bundler keeps doc comments on internal `name$1` functions and writes public options as
 * `ProviderOptions<Parameters<typeof name$1>[n]>`, or as an inline object. Both print as `options?: object`
 * and name the internal types. Copy the comment onto the export and turn that shape into an interface of the
 * public fields (required `providers` becomes optional `readonly Provider[]`, which is what `ProviderOptions`
 * means) so TypeDoc documents the published surface.
 */
export function prepareEntrySource(source: string): string {
  const file = ts.createSourceFile("entry.d.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = new Map<string, ts.FunctionDeclaration>();
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  const aliases = new Map<string, ts.TypeAliasDeclaration>();
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
      names.add(statement.name.text);
    } else if (ts.isInterfaceDeclaration(statement)) {
      interfaces.set(statement.name.text, statement);
      names.add(statement.name.text);
    } else if (ts.isTypeAliasDeclaration(statement)) {
      aliases.set(statement.name.text, statement);
      names.add(statement.name.text);
    }
  }

  const edits: Edit[] = [];
  for (const statement of file.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      const ref = providerOptionsRef(statement.type);
      if (!ref) {
        continue;
      }
      edits.push({
        start: statement.getStart(file),
        end: statement.getEnd(),
        text: optionsExport(statement.name.text, ref, functions, interfaces, aliases, file)
      });
      continue;
    }
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !isExported(statement)) {
      continue;
    }
    const name = statement.name.text;
    if (name.endsWith("$1")) {
      continue;
    }
    const prefix = functionPrefix(statement, name, functions, interfaces, aliases, names, file);
    if (prefix !== undefined) {
      edits.push({ start: statement.getStart(file), end: statement.getStart(file), text: prefix });
    }
    for (const parameter of statement.parameters) {
      if (!parameter.type || !isInlineOptions(parameter)) {
        continue;
      }
      const interfaceName = optionsInterfaceName(name);
      if (names.has(interfaceName)) {
        throw new Error(`${interfaceName} already exists; cannot name the options of ${name}`);
      }
      names.add(interfaceName);
      edits.push({
        start: parameter.type.getStart(file),
        end: parameter.type.getEnd(),
        text: interfaceName
      });
    }
  }

  return ensureProviderName(applyEdits(source, edits));
}
