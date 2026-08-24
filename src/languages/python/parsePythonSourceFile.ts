import Parser from "tree-sitter";
import Python from "tree-sitter-python";

import {
  DEFAULT_FRAMEWORK_REGISTRY,
  type FrameworkRegistry,
  type PythonConventionIndex,
} from "../../frameworks/registry.ts";
import type {
  PythonCallConvention,
  PythonDecoratorConvention,
} from "../../frameworks/types.js";
import type {
  LineRange,
  ParsedCall,
  ParsedEntryPoint,
  ParsedEvent,
  ParsedExport,
  ParsedImport,
  ParsedReference,
  ParsedSourceFile,
  ParsedSymbol,
  ParseDiagnostic,
} from "../../parser/types.js";

const HTTP_METHODS = new Set([
  "delete", "get", "head", "options", "patch", "post", "put", "route", "websocket",
]);
const EVENT_SUBSCRIBE_METHODS = new Set(["consume", "listen", "on", "once", "subscribe"]);
const EVENT_PUBLISH_METHODS = new Set(["dispatch", "emit", "publish", "send"]);
const IGNORED_DECORATORS = new Set([
  "abstractmethod", "cached_property", "classmethod", "dataclass", "fixture", "lru_cache",
  "override", "property", "staticmethod", "validator", "wraps",
]);
const PARSER_INPUT_CHUNK_SIZE = 16_384;

export function parsePythonSourceFile(
  filePath: string,
  source: string,
  registry: FrameworkRegistry = DEFAULT_FRAMEWORK_REGISTRY,
): ParsedSourceFile {
  const conventions = registry.python();
  const parser = new Parser();
  parser.setLanguage(Python);
  const tree = parser.parse((index) =>
    source.slice(index, index + PARSER_INPUT_CHUNK_SIZE)
  );
  const rootNode = tree.rootNode;
  const imports = extractImports(rootNode);
  const symbols = extractSymbols(rootNode);
  const entrypointResult = extractEntryPoints(rootNode, symbols, conventions);

  return {
    path: filePath,
    language: "python",
    symbols,
    imports,
    exports: extractExports(symbols),
    calls: extractCalls(
      rootNode,
      uniqueImportLocalNames(imports),
      uniqueLocalFunctionNames(symbols),
    ),
    entrypoints: entrypointResult.entrypoints,
    events: extractEvents(rootNode),
    renders: [],
    references: extractReferences(rootNode, uniqueImportLocalNames(imports)),
    diagnostics: extractDiagnostics(rootNode),
    frameworkDiagnostics: entrypointResult.diagnostics,
  };
}

function extractImports(rootNode: Parser.SyntaxNode): ParsedImport[] {
  const imports: ParsedImport[] = [];

  for (const node of rootNode.namedChildren) {
    if (node.type === "import_statement") {
      for (const importedNode of node.namedChildren) {
        const aliased = aliasedImport(importedNode);
        const source = aliased?.source ?? importedNode.text;
        if (source.length === 0) continue;
        imports.push({
          kind: "namespace",
          source,
          importedName: "*",
          localName: aliased?.localName ?? source.split(".")[0] ?? source,
          typeOnly: false,
          lineRange: toLineRange(importedNode),
        });
      }
      continue;
    }

    if (node.type !== "import_from_statement") continue;
    const moduleNode = node.childForFieldName("module_name");
    if (moduleNode === null) continue;
    const moduleSource = moduleNode.text;
    for (const importedNode of node.namedChildren) {
      if (importedNode.id === moduleNode.id) continue;
      if (importedNode.type === "wildcard_import") {
        imports.push({
          kind: "namespace",
          source: moduleSource,
          importedName: "*",
          localName: "*",
          typeOnly: false,
          lineRange: toLineRange(importedNode),
        });
        continue;
      }

      const aliased = aliasedImport(importedNode);
      const importedName = aliased?.source ?? importedNode.text;
      if (importedName.length === 0) continue;
      const source = moduleSource === "."
        ? `.${importedName}`
        : moduleSource;
      imports.push({
        kind: moduleSource === "." ? "namespace" : "named",
        source,
        importedName: moduleSource === "." ? "*" : importedName,
        localName: aliased?.localName ?? importedName.split(".").at(-1) ?? importedName,
        typeOnly: moduleSource === "__future__",
        lineRange: toLineRange(importedNode),
      });
    }
  }

  return imports.sort(compareByLineRange);
}

function aliasedImport(
  node: Parser.SyntaxNode,
): { source: string; localName: string } | undefined {
  if (node.type !== "aliased_import") return undefined;
  const nameNode = node.childForFieldName("name");
  const aliasNode = node.childForFieldName("alias");
  return nameNode === null || aliasNode === null
    ? undefined
    : { source: nameNode.text, localName: aliasNode.text };
}

function extractSymbols(rootNode: Parser.SyntaxNode): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  for (const node of rootNode.namedChildren) {
    const definition = definitionNode(node);
    if (definition?.type === "function_definition") {
      const name = definition.childForFieldName("name")?.text;
      if (name !== undefined) symbols.push(symbol("function", name, definition, isPublic(name)));
      continue;
    }
    if (definition?.type === "class_definition") {
      const className = definition.childForFieldName("name")?.text;
      if (className === undefined) continue;
      symbols.push(symbol("class", className, definition, isPublic(className)));
      symbols.push(...classMethodSymbols(definition, className));
      continue;
    }
    if (node.type !== "expression_statement") continue;
    const assignment = node.namedChildren.find((child) =>
      child.type === "assignment" || child.type === "named_expression"
    );
    const left = assignment?.childForFieldName("left") ?? assignment?.childForFieldName("name");
    if (left?.type === "identifier") {
      symbols.push(symbol("variable", left.text, assignment ?? node, isPublic(left.text)));
    }
  }
  return symbols.sort(compareSymbols);
}

function classMethodSymbols(
  classNode: Parser.SyntaxNode,
  className: string,
): ParsedSymbol[] {
  const body = classNode.childForFieldName("body");
  if (body === null) return [];
  return body.namedChildren.flatMap((node) => {
    const definition = definitionNode(node);
    if (definition?.type !== "function_definition") return [];
    const methodName = definition.childForFieldName("name")?.text;
    return methodName === undefined
      ? []
      : [symbol("function", `${className}.${methodName}`, definition, false)];
  });
}

function symbol(
  type: ParsedSymbol["type"],
  name: string,
  node: Parser.SyntaxNode,
  exported: boolean,
): ParsedSymbol {
  return { type, name, exported, lineRange: toLineRange(node) };
}

function extractExports(symbols: readonly ParsedSymbol[]): ParsedExport[] {
  return symbols.flatMap((item) =>
    item.exported && !item.name.includes(".")
      ? [{
          kind: "named" as const,
          exportedName: item.name,
          localName: item.name,
          typeOnly: false,
          lineRange: { ...item.lineRange },
        }]
      : []
  );
}

function extractCalls(
  rootNode: Parser.SyntaxNode,
  importedLocalNames: ReadonlySet<string>,
  localFunctionNames: ReadonlySet<string>,
): ParsedCall[] {
  return rootNode.descendantsOfType("call").map((callNode) => {
    const calleeNode = callNode.childForFieldName("function");
    const callee = calleeNode?.text ?? "<dynamic>";
    const caller = enclosingCallableName(callNode);
    const rootName = calleeNode === null ? undefined : rootIdentifier(calleeNode);
    const kind: ParsedCall["kind"] = calleeNode?.type === "identifier"
      ? "identifier"
      : calleeNode?.type === "attribute" || calleeNode?.type === "subscript"
        ? "member"
        : "other";
    const localTargetName = calleeNode?.type === "identifier" &&
        localFunctionNames.has(callee) &&
        !hasEnclosingPythonShadow(callNode, callee)
      ? callee
      : undefined;
    return {
      callee,
      kind,
      ...(caller === undefined ? {} : { caller }),
      ...(rootName !== undefined && importedLocalNames.has(rootName)
        ? { importedLocalName: rootName }
        : {}),
      ...(localTargetName === undefined ? {} : { localTargetName }),
      lineRange: toLineRange(callNode),
    };
  }).sort(compareByLineRange);
}

function extractReferences(
  rootNode: Parser.SyntaxNode,
  importedLocalNames: ReadonlySet<string>,
): ParsedReference[] {
  const references: ParsedReference[] = [];

  for (const identifier of rootNode.descendantsOfType("identifier")) {
    const ownerName = enclosingCallableName(identifier);
    if (
      ownerName === undefined ||
      !importedLocalNames.has(identifier.text) ||
      identifier.parent?.type === "attribute" ||
      isCallCallee(identifier)
    ) {
      continue;
    }
    references.push({
      targetName: identifier.text,
      ownerName,
      importedLocalName: identifier.text,
      lineRange: toLineRange(identifier),
    });
  }

  for (const attribute of rootNode.descendantsOfType("attribute")) {
    const ownerName = enclosingCallableName(attribute);
    const rootName = rootIdentifier(attribute);
    if (
      ownerName === undefined ||
      rootName === undefined ||
      !importedLocalNames.has(rootName) ||
      isCallCallee(attribute)
    ) {
      continue;
    }
    const suffix = attribute.text.slice(rootName.length + 1);
    if (suffix.length === 0 || /[.\[\]?]/u.test(suffix)) continue;
    references.push({
      targetName: attribute.text,
      ownerName,
      importedLocalName: rootName,
      lineRange: toLineRange(attribute),
    });
  }

  for (const definition of rootNode.descendantsOfType("function_definition")) {
    const ownerName = qualifiedFunctionName(definition);
    if (ownerName === undefined) continue;
    const typeNodes: Parser.SyntaxNode[] = [];
    const parameters = definition.childForFieldName("parameters");
    if (parameters !== null) {
      for (const parameter of parameters.namedChildren) {
        const typeNode = parameter.childForFieldName("type");
        if (typeNode !== null) typeNodes.push(typeNode);
      }
    }
    const returnType = definition.childForFieldName("return_type");
    if (returnType !== null) typeNodes.push(returnType);

    const decorated = definition.parent?.type === "decorated_definition"
      ? definition.parent
      : undefined;
    for (const decorator of decorated?.namedChildren ?? []) {
      if (decorator.type !== "decorator") continue;
      for (const keyword of decorator.descendantsOfType("keyword_argument")) {
        const name = keyword.childForFieldName("name")?.text;
        const value = keyword.childForFieldName("value");
        if (/^(?:request_model|response_model|schema)$/u.test(name ?? "") && value !== null) {
          typeNodes.push(value);
        }
      }
    }

    for (const typeNode of typeNodes) {
      for (const identifier of importedIdentifiers(typeNode, importedLocalNames)) {
        references.push({
          targetName: identifier.text,
          ownerName,
          importedLocalName: identifier.text,
          lineRange: toLineRange(identifier),
        });
      }
    }
  }

  return deduplicateReferences(references).sort(compareByLineRange);
}

function importedIdentifiers(
  node: Parser.SyntaxNode,
  importedLocalNames: ReadonlySet<string>,
): Parser.SyntaxNode[] {
  const identifiers = [
    ...(node.type === "identifier" ? [node] : []),
    ...node.descendantsOfType("identifier"),
  ];
  return identifiers.filter((identifier) => importedLocalNames.has(identifier.text));
}

function isCallCallee(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  return parent?.type === "call" && parent.childForFieldName("function")?.id === node.id;
}

function deduplicateReferences(
  references: ParsedReference[],
): ParsedReference[] {
  const result: ParsedReference[] = [];
  const keys = new Set<string>();
  for (const reference of references) {
    const key = [
      reference.ownerName ?? "",
      reference.targetName,
      reference.lineRange.start,
      reference.lineRange.end,
    ].join("\u0000");
    if (keys.has(key)) continue;
    keys.add(key);
    result.push(reference);
  }
  return result;
}

function uniqueLocalFunctionNames(
  symbols: readonly ParsedSymbol[],
): Set<string> {
  const counts = new Map<string, number>();
  for (const symbol of symbols) {
    if (symbol.name.includes(".")) continue;
    counts.set(symbol.name, (counts.get(symbol.name) ?? 0) + 1);
  }
  return new Set(symbols.flatMap((symbol) =>
    symbol.type === "function" &&
      !symbol.name.includes(".") &&
      counts.get(symbol.name) === 1
      ? [symbol.name]
      : []
  ));
}

function hasEnclosingPythonShadow(
  callNode: Parser.SyntaxNode,
  name: string,
): boolean {
  let current = callNode.parent;
  while (current !== null && current.type !== "module") {
    if (current.type === "function_definition") {
      if (current.childForFieldName("name")?.text === name) return false;
      const parameters = current.childForFieldName("parameters");
      if (parameters !== null && nodeContainsIdentifier(parameters, name)) {
        return true;
      }
      const body = current.childForFieldName("body");
      if (body !== null && pythonBodyBindsName(body, name)) return true;
    }
    current = current.parent;
  }
  return false;
}

function pythonBodyBindsName(
  node: Parser.SyntaxNode,
  name: string,
): boolean {
  for (const child of node.namedChildren) {
    const definition = definitionNode(child);
    if (
      definition?.type === "function_definition" ||
      definition?.type === "class_definition"
    ) {
      if (definition.childForFieldName("name")?.text === name) return true;
      continue;
    }
    if (
      child.type === "assignment" ||
      child.type === "augmented_assignment" ||
      child.type === "named_expression"
    ) {
      const binding = child.childForFieldName("left") ??
        child.childForFieldName("name");
      if (binding !== null && nodeContainsIdentifier(binding, name)) return true;
    }
    if (child.type === "for_statement") {
      const binding = child.childForFieldName("left");
      if (binding !== null && nodeContainsIdentifier(binding, name)) return true;
    }
    if (
      (child.type === "global_statement" || child.type === "nonlocal_statement") &&
      nodeContainsIdentifier(child, name)
    ) {
      return true;
    }
    if (pythonBodyBindsName(child, name)) return true;
  }
  return false;
}

function nodeContainsIdentifier(node: Parser.SyntaxNode, name: string): boolean {
  if (node.type === "identifier" && node.text === name) return true;
  return node.namedChildren.some((child) => nodeContainsIdentifier(child, name));
}

function extractEntryPoints(
  rootNode: Parser.SyntaxNode,
  symbols: readonly ParsedSymbol[],
  conventions: PythonConventionIndex,
): {
  entrypoints: ParsedEntryPoint[];
  diagnostics: NonNullable<ParsedSourceFile["frameworkDiagnostics"]>;
} {
  const entrypoints: ParsedEntryPoint[] = [];
  const diagnostics: NonNullable<ParsedSourceFile["frameworkDiagnostics"]> = [];
  const routerPrefixes = extractRouterPrefixes(rootNode);

  for (const decorated of rootNode.descendantsOfType("decorated_definition")) {
    const definition = decorated.childForFieldName("definition");
    if (definition?.type !== "function_definition") continue;
    const handlerName = qualifiedFunctionName(definition);
    if (handlerName === undefined) continue;
    for (const decorator of decorated.namedChildren.filter((child) => child.type === "decorator")) {
      const entrypoint = decoratorEntryPoint(
        decorator,
        handlerName,
        conventions,
        routerPrefixes,
      );
      if (entrypoint !== undefined) {
        entrypoints.push(entrypoint);
      } else if (looksLikeEntrypointDecorator(decorator)) {
        diagnostics.push({
          kind: "unresolved-decorator",
          message: `Unrecognized entrypoint-like decorator: ${decorator.text}`,
          lineRange: toLineRange(decorator),
        });
      }
    }
  }

  for (const callNode of rootNode.descendantsOfType("call")) {
    const entrypoint = callEntryPoint(callNode, conventions);
    if (entrypoint !== undefined) entrypoints.push(entrypoint);
  }

  for (const item of symbols) {
    if (item.type !== "function" || item.name.includes(".")) continue;
    if (conventions.startupSymbolNames.has(item.name)) {
      entrypoints.push(createEntryPoint("startup", item.name, item.lineRange, item.name, {
        exposure: "startup",
      }));
    }
    if (conventions.exportedApplicationHandlerNames.has(item.name)) {
      entrypoints.push(createEntryPoint("application", item.name, item.lineRange, item.name));
    }
  }

  for (const ifNode of rootNode.descendantsOfType("if_statement")) {
    const condition = ifNode.childForFieldName("condition")?.text.replace(/\s+/gu, "") ?? "";
    if (
      condition === "__name__=='__main__'" ||
      condition === "__name__==\"__main__\"" ||
      condition === "'__main__'==__name__" ||
      condition === "\"__main__\"==__name__"
    ) {
      entrypoints.push(createEntryPoint("startup", "python __main__", toLineRange(ifNode), undefined, {
        exposure: "startup",
      }));
    }
  }

  for (const assignment of rootNode.descendantsOfType("assignment")) {
    const left = assignment.childForFieldName("left");
    const right = assignment.childForFieldName("right");
    const callee = right?.type === "call" ? right.childForFieldName("function")?.text : undefined;
    const factory = callee?.split(".").at(-1);
    if (
      left?.type === "identifier" &&
      factory !== undefined &&
      conventions.applicationFactoryNames.has(factory)
    ) {
      entrypoints.push(createEntryPoint(
        "application",
        `${left.text} application`,
        toLineRange(assignment),
      ));
    }
  }

  return {
    entrypoints: deduplicateEntrypoints(entrypoints),
    diagnostics: diagnostics.sort(compareByLineRange),
  };
}

function decoratorEntryPoint(
  decorator: Parser.SyntaxNode,
  handlerName: string,
  conventions: PythonConventionIndex,
  routerPrefixes: ReadonlyMap<string, string>,
): ParsedEntryPoint | undefined {
  const expression = decorator.namedChildren[0];
  const call = expression?.type === "call" ? expression : undefined;
  const callable = call?.childForFieldName("function") ?? expression;
  const decoratorName = callable?.text.replace(/^@/u, "");
  if (decoratorName === undefined) return undefined;
  const rule = decoratorConvention(decoratorName, call, conventions);
  if (rule === undefined) return undefined;
  const trigger = call === undefined ? undefined : firstStaticArgument(call);
  const decoratorOwner = decoratorName.split(".").slice(0, -1).join(".");
  const route = trigger === undefined
    ? undefined
    : joinRoutePrefix(routerPrefixes.get(decoratorOwner), trigger);
  const httpMethod = rule.httpMethod ?? methodsKeyword(call)?.[0];
  const graphHttpMethod = rule.kind === "websocket"
    ? httpMethod ?? "GET"
    : rule.kind === "http"
      ? httpMethod ?? "ANY"
      : undefined;
  const baseName = route ?? unqualifiedName(handlerName);
  const name = rule.kind === "http" || rule.kind === "websocket"
    ? `${rule.kind === "websocket" ? "WS" : httpMethod ?? "HTTP"} ${baseName}`
    : `${rule.namePrefix ?? rule.kind} ${baseName}`;
  return createEntryPoint(rule.kind, name, toLineRange(decorator), handlerName, {
    ...(graphHttpMethod === undefined ? {} : { httpMethod: graphHttpMethod }),
    ...(route === undefined ? {} : { route }),
  });
}

function extractRouterPrefixes(rootNode: Parser.SyntaxNode): Map<string, string> {
  const result = new Map<string, string>();
  for (const assignment of rootNode.descendantsOfType("assignment")) {
    const left = assignment.childForFieldName("left");
    const right = assignment.childForFieldName("right");
    if (left?.type !== "identifier" || right?.type !== "call") continue;
    const factory = right.childForFieldName("function")?.text.split(".").at(-1);
    if (factory !== "APIRouter") continue;
    const prefix = staticKeywordArgument(right, "prefix");
    if (prefix !== undefined) result.set(left.text, normalizeRoutePrefix(prefix));
  }
  return result;
}

function joinRoutePrefix(prefix: string | undefined, route: string): string {
  if (prefix === undefined || prefix.length === 0 || prefix === "/") return route;
  if (route.length === 0 || route === "/") return normalizeRoutePrefix(prefix);
  return `${normalizeRoutePrefix(prefix)}/${route.replace(/^\/+|\/+$/gu, "")}`;
}

function normalizeRoutePrefix(prefix: string): string {
  const normalized = `/${prefix.replace(/^\/+|\/+$/gu, "")}`;
  return normalized === "/" ? "" : normalized;
}

function decoratorConvention(
  decoratorName: string,
  call: Parser.SyntaxNode | undefined,
  conventions: PythonConventionIndex,
): PythonDecoratorConvention | undefined {
  const exact = conventions.decorators.find((rule) => rule.decorator === decoratorName);
  if (exact !== undefined) return exact;
  const method = decoratorName.split(".").at(-1)?.toLowerCase();
  if (call !== undefined && method !== undefined && HTTP_METHODS.has(method)) {
    return {
      decorator: decoratorName,
      kind: method === "websocket" ? "websocket" : "http",
      ...(method === "route" || method === "websocket"
        ? {}
        : { httpMethod: method.toUpperCase() }),
    };
  }
  return undefined;
}

function callEntryPoint(
  callNode: Parser.SyntaxNode,
  conventions: PythonConventionIndex,
): ParsedEntryPoint | undefined {
  const callee = callNode.childForFieldName("function")?.text;
  if (callee === undefined) return undefined;
  const rule = callConvention(callee, conventions);
  if (rule === undefined) return undefined;
  const trigger = firstStaticArgument(callNode);
  if (trigger === undefined) return undefined;
  const argumentsNode = callNode.childForFieldName("arguments");
  const handlerNode = rule.handlerArgumentIndex === undefined
    ? undefined
    : positionalArguments(argumentsNode)[rule.handlerArgumentIndex];
  const handlerName = handlerNode?.type === "identifier" || handlerNode?.type === "attribute"
    ? handlerNode.text
    : undefined;
  return createEntryPoint(
    rule.kind,
    rule.kind === "http" ? `${rule.httpMethod ?? "HTTP"} ${trigger}` : `${rule.namePrefix ?? rule.kind} ${trigger}`,
    toLineRange(callNode),
    handlerName,
    {
      ...(rule.kind === "http" || rule.kind === "websocket"
        ? { httpMethod: rule.httpMethod ?? (rule.kind === "websocket" ? "GET" : "ANY") }
        : {}),
      ...(rule.kind === "http" || rule.kind === "websocket" ? { route: trigger } : {}),
    },
  );
}

function callConvention(
  callee: string,
  conventions: PythonConventionIndex,
): PythonCallConvention | undefined {
  return conventions.calls.find((rule) =>
    rule.callee === callee || callee.endsWith(`.${rule.callee}`)
  );
}

function extractEvents(rootNode: Parser.SyntaxNode): ParsedEvent[] {
  return rootNode.descendantsOfType("call").flatMap((callNode) => {
    const callee = callNode.childForFieldName("function")?.text;
    const method = callee?.split(".").at(-1);
    if (method === undefined) return [];
    const operation = EVENT_SUBSCRIBE_METHODS.has(method)
      ? "subscribe" as const
      : EVENT_PUBLISH_METHODS.has(method) || /^(?:emit|publish|dispatch)[A-Z_]/u.test(method)
        ? "publish" as const
        : undefined;
    const name = operation === undefined ? undefined : firstStaticArgument(callNode);
    if (operation === undefined || name === undefined) return [];
    const ownerName = enclosingCallableName(callNode);
    return [{
      name,
      operation,
      ...(ownerName === undefined ? {} : { ownerName }),
      lineRange: toLineRange(callNode),
    }];
  }).sort(compareByLineRange);
}

function createEntryPoint(
  kind: ParsedEntryPoint["kind"],
  name: string,
  lineRange: LineRange,
  handlerName?: string,
  details: {
    exposure?: ParsedEntryPoint["exposure"];
    httpMethod?: string;
    route?: string;
  } = {},
): ParsedEntryPoint {
  return {
    kind,
    name,
    exposure: details.exposure ?? "external",
    ...(details.httpMethod === undefined ? {} : { httpMethod: details.httpMethod }),
    ...(details.route === undefined ? {} : { route: details.route }),
    ...(handlerName === undefined ? {} : { handlerName }),
    lineRange: { ...lineRange },
  };
}

function definitionNode(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  return node.type === "decorated_definition"
    ? node.childForFieldName("definition") ?? undefined
    : node.type === "function_definition" || node.type === "class_definition"
      ? node
      : undefined;
}

function qualifiedFunctionName(node: Parser.SyntaxNode): string | undefined {
  const name = node.childForFieldName("name")?.text;
  if (name === undefined) return undefined;
  let current = node.parent;
  while (current !== null) {
    if (current.type === "class_definition") {
      const className = current.childForFieldName("name")?.text;
      return className === undefined ? name : `${className}.${name}`;
    }
    current = current.parent;
  }
  return name;
}

function enclosingCallableName(node: Parser.SyntaxNode): string | undefined {
  let current = node.parent;
  while (current !== null) {
    if (current.type === "function_definition") return qualifiedFunctionName(current);
    current = current.parent;
  }
  return undefined;
}

function rootIdentifier(node: Parser.SyntaxNode): string | undefined {
  if (node.type === "identifier") return node.text;
  if (node.type === "attribute" || node.type === "subscript") {
    const object = node.childForFieldName("object") ?? node.namedChildren[0];
    return object === undefined || object === null ? undefined : rootIdentifier(object);
  }
  return undefined;
}

function firstStaticArgument(callNode: Parser.SyntaxNode): string | undefined {
  return positionalArguments(callNode.childForFieldName("arguments"))
    .map(staticStringValue)
    .find((value): value is string => value !== undefined);
}

function positionalArguments(
  argumentsNode: Parser.SyntaxNode | null,
): Parser.SyntaxNode[] {
  return argumentsNode?.namedChildren.filter((child) =>
    child.type !== "keyword_argument" && child.type !== "dictionary_splat"
  ) ?? [];
}

function methodsKeyword(callNode: Parser.SyntaxNode | undefined): string[] | undefined {
  const argumentsNode = callNode?.childForFieldName("arguments");
  const keyword = argumentsNode?.namedChildren.find((child) =>
    child.type === "keyword_argument" && child.childForFieldName("name")?.text === "methods"
  );
  const value = keyword?.childForFieldName("value");
  if (value === null || value === undefined) return undefined;
  const values = value.type === "list" || value.type === "tuple"
    ? value.namedChildren.map(staticStringValue).filter((item): item is string => item !== undefined)
    : [staticStringValue(value)].filter((item): item is string => item !== undefined);
  return values.map((item) => item.toUpperCase());
}

function staticKeywordArgument(
  callNode: Parser.SyntaxNode,
  name: string,
): string | undefined {
  const argumentsNode = callNode.childForFieldName("arguments");
  const keyword = argumentsNode?.namedChildren.find((child) =>
    child.type === "keyword_argument" && child.childForFieldName("name")?.text === name
  );
  const value = keyword?.childForFieldName("value");
  return value === null || value === undefined ? undefined : staticStringValue(value);
}

function staticStringValue(node: Parser.SyntaxNode): string | undefined {
  if (node.type !== "string" && node.type !== "concatenated_string") return undefined;
  if (node.descendantsOfType("interpolation").length > 0) return undefined;
  const content = node.descendantsOfType("string_content").map((item) => item.text).join("");
  if (content.length > 0 || node.text.length >= 2) {
    return content.length > 0
      ? content
      : node.text
          .replace(/^[rubfRUBF]*(?:'''|"""|'|")/u, "")
          .replace(/(?:'''|"""|'|")$/u, "");
  }
  return undefined;
}

function looksLikeEntrypointDecorator(decorator: Parser.SyntaxNode): boolean {
  const expression = decorator.namedChildren[0];
  const callable = expression?.type === "call"
    ? expression.childForFieldName("function")
    : expression;
  const name = callable?.text.replace(/^@/u, "");
  if (name === undefined || IGNORED_DECORATORS.has(name.split(".").at(-1) ?? name)) return false;
  const method = name.split(".").at(-1)?.toLowerCase();
  return method !== undefined && (
    HTTP_METHODS.has(method) ||
    ["command", "consumer", "cron", "dag", "event", "handler", "job", "route", "task", "websocket"].includes(method)
  );
}

function uniqueImportLocalNames(imports: readonly ParsedImport[]): Set<string> {
  const counts = new Map<string, number>();
  for (const item of imports) {
    if (item.typeOnly || item.localName === undefined || item.localName === "*") continue;
    counts.set(item.localName, (counts.get(item.localName) ?? 0) + 1);
  }
  return new Set([...counts].flatMap(([name, count]) => count === 1 ? [name] : []));
}

function deduplicateEntrypoints(values: readonly ParsedEntryPoint[]): ParsedEntryPoint[] {
  const byKey = new Map<string, ParsedEntryPoint>();
  for (const value of values) {
    const key = [value.kind, value.name, value.handlerName ?? "", value.lineRange.start].join("\0");
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.values()].sort(compareEntrypoints);
}

function extractDiagnostics(rootNode: Parser.SyntaxNode): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  walkAll(rootNode, (node) => {
    if (!node.isError && !node.isMissing) return;
    diagnostics.push({
      kind: node.isMissing ? "missing" : "error",
      nodeType: node.type,
      lineRange: toLineRange(node),
    });
  });
  return diagnostics;
}

function isPublic(name: string): boolean {
  return !name.startsWith("_");
}

function unqualifiedName(name: string): string {
  return name.split(".").at(-1) ?? name;
}

function toLineRange(node: Parser.SyntaxNode): LineRange {
  return { start: node.startPosition.row + 1, end: node.endPosition.row + 1 };
}

function compareSymbols(left: ParsedSymbol, right: ParsedSymbol): number {
  return compareByLineRange(left, right) || compareStrings(left.name, right.name);
}

function compareEntrypoints(left: ParsedEntryPoint, right: ParsedEntryPoint): number {
  return compareByLineRange(left, right) || compareStrings(left.name, right.name);
}

function compareByLineRange(
  left: { lineRange: LineRange },
  right: { lineRange: LineRange },
): number {
  return left.lineRange.start - right.lineRange.start || left.lineRange.end - right.lineRange.end;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function walkAll(node: Parser.SyntaxNode, visit: (node: Parser.SyntaxNode) => void): void {
  visit(node);
  for (const child of node.children) walkAll(child, visit);
}
