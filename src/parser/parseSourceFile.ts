import { extname } from "node:path";

import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TypeScriptLanguages from "tree-sitter-typescript";

import {
  DEFAULT_FRAMEWORK_REGISTRY,
  type FrameworkRegistry,
  type JavaScriptConventionIndex,
} from "../frameworks/registry.ts";
import type {
  LineRange,
  ParsedCall,
  ParsedCallKind,
  ParsedEntryPoint,
  ParsedEntryPointKind,
  ParsedEvent,
  ParsedExport,
  ParsedExportKind,
  ParsedImport,
  ParsedImportKind,
  ParsedLanguage,
  ParsedReference,
  ParsedRender,
  ParsedSourceFile,
  ParsedSymbol,
  ParseDiagnostic,
} from "./types.js";

const JAVASCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs"]);
const TYPESCRIPT_EXTENSIONS = new Set([".cts", ".mts", ".ts"]);
const FUNCTION_DECLARATION_TYPES = new Set([
  "function_declaration",
  "generator_function_declaration",
]);
const FUNCTION_EXPRESSION_TYPES = new Set([
  "arrow_function",
  "function_expression",
  "generator_function",
]);
const METHOD_TYPES = new Set(["abstract_method_signature", "method_definition"]);
const CLASS_TYPES = new Set([
  "abstract_class_declaration",
  "class",
  "class_declaration",
]);
const TYPE_DECLARATION_TYPES = new Set([
  "interface_declaration",
  "type_alias_declaration",
]);
const REACT_DOM_BOOTSTRAP_METHODS = new Set(["createRoot", "hydrateRoot"]);
const REACT_DOM_MODULES = new Set(["react-dom", "react-dom/client"]);
const PARSER_INPUT_CHUNK_SIZE = 16_384;

export function parseSourceFile(
  filePath: string,
  source: string,
  registry: FrameworkRegistry = DEFAULT_FRAMEWORK_REGISTRY,
): ParsedSourceFile {
  return parseJavaScriptSourceFile(
    filePath,
    source,
    detectParsedLanguage(filePath),
    registry,
  );
}

export function parseJavaScriptSourceFile(
  filePath: string,
  source: string,
  language: "javascript" | "typescript" | "tsx",
  registry: FrameworkRegistry = DEFAULT_FRAMEWORK_REGISTRY,
): ParsedSourceFile {
  const conventions = registry.javascript();
  const parser = new Parser();
  parser.setLanguage(grammarForLanguage(language));

  let tree = parser.parse((index) =>
    source.slice(index, index + PARSER_INPUT_CHUNK_SIZE),
  );
  if (language === "tsx" || language === "javascript") {
    const initialDiagnostics = extractDiagnostics(tree.rootNode);
    if (initialDiagnostics.length > 0) {
      const escapedSource = escapeBareAmpersandsInJsxErrors(
        source,
        tree.rootNode,
      );
      if (escapedSource !== source) {
        const escapedTree = parser.parse((index) =>
          escapedSource.slice(index, index + PARSER_INPUT_CHUNK_SIZE)
        );
        if (
          extractDiagnostics(escapedTree.rootNode).length <
            initialDiagnostics.length
        ) {
          tree = escapedTree;
        }
      }
    }
  }
  const imports = extractImports(tree.rootNode);
  const exports = extractExports(tree.rootNode);
  const exportedLocalNames = new Set(
    exports
      .filter((entry) => entry.source === undefined)
      .flatMap((entry) =>
        entry.localName === undefined ? [] : [entry.localName],
      ),
  );

  const symbols = extractSymbols(tree.rootNode, exportedLocalNames);
  const entrypoints = extractEntryPoints(
    filePath,
    tree.rootNode,
    symbols,
    imports,
    exports,
    conventions,
  );
  const frameworkDiagnostics = extractFrameworkDiagnostics(
    tree.rootNode,
    entrypoints,
    symbols,
    imports,
    conventions,
  );
  const references = extractJsxValueReferences(tree.rootNode);

  return {
    path: filePath,
    language,
    symbols,
    imports,
    exports,
    calls: extractCalls(
      tree.rootNode,
      uniqueValueImportLocalNames(imports),
      uniqueFunctionSymbolNames(symbols),
    ),
    entrypoints,
    events: extractEvents(tree.rootNode, conventions),
    renders: extractRenders(tree.rootNode),
    ...(references.length === 0 ? {} : { references }),
    diagnostics: extractDiagnostics(tree.rootNode),
    ...(frameworkDiagnostics.length === 0 ? {} : { frameworkDiagnostics }),
  };
}

function escapeBareAmpersandsInJsxErrors(
  source: string,
  rootNode: Parser.SyntaxNode,
): string {
  const ranges = new Map<string, { start: number; end: number }>();
  for (const errorNode of rootNode.descendantsOfType("ERROR")) {
    const attributeString = jsxAttributeStringAncestor(errorNode);
    const recoverableNode = attributeString ??
      (isJsxTextError(errorNode) ? errorNode : undefined);
    if (recoverableNode === undefined) continue;
    ranges.set(
      `${recoverableNode.startIndex}:${recoverableNode.endIndex}`,
      { start: recoverableNode.startIndex, end: recoverableNode.endIndex },
    );
  }

  let recovered = source;
  const orderedRanges = [...ranges.values()].sort(
    (left, right) => right.start - left.start || right.end - left.end,
  );
  for (const range of orderedRanges) {
    const segment = recovered.slice(range.start, range.end);
    const escaped = escapeBareAmpersands(segment);
    recovered = `${recovered.slice(0, range.start)}${escaped}${recovered.slice(range.end)}`;
  }
  return recovered;
}

function jsxAttributeStringAncestor(
  node: Parser.SyntaxNode,
): Parser.SyntaxNode | undefined {
  let current = node.parent;
  while (current !== null) {
    if (current.type === "jsx_expression") return undefined;
    if (
      current.type === "string" &&
      current.parent?.type === "jsx_attribute"
    ) {
      return current;
    }
    if (
      current.type === "jsx_element" ||
      current.type === "jsx_fragment"
    ) {
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

function isJsxTextError(node: Parser.SyntaxNode): boolean {
  let current = node.parent;
  while (current !== null) {
    if (
      current.type === "jsx_expression" ||
      current.type === "jsx_attribute"
    ) {
      return false;
    }
    if (
      current.type === "jsx_element" ||
      current.type === "jsx_fragment"
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function escapeBareAmpersands(value: string): string {
  return value.replace(
    /&(?!(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);)/giu,
    "&amp;",
  );
}

export function detectParsedLanguage(
  filePath: string,
): Exclude<ParsedLanguage, "python"> {
  const extension = extname(filePath).toLowerCase();

  if (extension === ".tsx") {
    return "tsx";
  }

  if (TYPESCRIPT_EXTENSIONS.has(extension)) {
    return "typescript";
  }

  if (JAVASCRIPT_EXTENSIONS.has(extension)) {
    return "javascript";
  }

  throw new Error(`Unsupported TypeScript/JavaScript file: ${filePath}`);
}

function grammarForLanguage(language: ParsedLanguage): unknown {
  if (language === "javascript") {
    return JavaScript;
  }

  if (language === "tsx") {
    return TypeScriptLanguages.tsx;
  }

  return TypeScriptLanguages.typescript;
}

function extractImports(rootNode: Parser.SyntaxNode): ParsedImport[] {
  const imports: ParsedImport[] = [];

  for (const importNode of rootNode.descendantsOfType("import_statement")) {
    const importRequireClause = importNode.namedChildren.find(
      (child) => child.type === "import_require_clause",
    );

    if (importRequireClause !== undefined) {
      const sourceNode = importRequireClause.childForFieldName("source");
      const localNameNode = importRequireClause.namedChildren.find(
        (child) => child.type === "identifier",
      );

      if (sourceNode !== null && localNameNode !== undefined) {
        imports.push(
          createImport({
            kind: "namespace",
            source: stringNodeValue(sourceNode),
            importedName: "*",
            localName: localNameNode.text,
            typeOnly: false,
            lineRange: toLineRange(importNode),
          }),
        );
      }

      continue;
    }

    const sourceNode = importNode.childForFieldName("source");
    if (sourceNode === null) {
      continue;
    }

    const sourceValue = stringNodeValue(sourceNode);
    const clause = importNode.namedChildren.find(
      (child) => child.type === "import_clause",
    );

    if (clause === undefined) {
      imports.push(
        createImport({
          kind: "side-effect",
          source: sourceValue,
          typeOnly: false,
          lineRange: toLineRange(importNode),
        }),
      );
      continue;
    }

    const statementTypeOnly = hasDirectChild(importNode, "type");
    const initialLength = imports.length;

    for (const clauseChild of clause.namedChildren) {
      if (clauseChild.type === "identifier") {
        imports.push(
          createImport({
            kind: "default",
            source: sourceValue,
            importedName: "default",
            localName: clauseChild.text,
            typeOnly: statementTypeOnly,
            lineRange: toLineRange(clauseChild),
          }),
        );
        continue;
      }

      if (clauseChild.type === "namespace_import") {
        const localNameNode = clauseChild.namedChildren.find(
          (child) => child.type === "identifier",
        );

        if (localNameNode !== undefined) {
          imports.push(
            createImport({
              kind: "namespace",
              source: sourceValue,
              importedName: "*",
              localName: localNameNode.text,
              typeOnly: statementTypeOnly,
              lineRange: toLineRange(clauseChild),
            }),
          );
        }

        continue;
      }

      if (clauseChild.type !== "named_imports") {
        continue;
      }

      for (const specifier of clauseChild.namedChildren) {
        if (specifier.type !== "import_specifier") {
          continue;
        }

        const importedNameNode = specifier.childForFieldName("name");
        if (importedNameNode === null) {
          continue;
        }

        const aliasNode = specifier.childForFieldName("alias");
        const importedName = nodeName(importedNameNode);
        imports.push(
          createImport({
            kind: "named",
            source: sourceValue,
            importedName,
            localName: aliasNode === null ? importedName : nodeName(aliasNode),
            typeOnly:
              statementTypeOnly || hasDirectChild(specifier, "type"),
            lineRange: toLineRange(specifier),
          }),
        );
      }
    }

    if (imports.length === initialLength) {
      imports.push(
        createImport({
          kind: "side-effect",
          source: sourceValue,
          typeOnly: statementTypeOnly,
          lineRange: toLineRange(importNode),
        }),
      );
    }
  }

  for (const callNode of rootNode.descendantsOfType("call_expression")) {
    const calleeNode = callNode.childForFieldName("function");
    const sourceNode = firstStringArgument(callNode);
    if (calleeNode === null || sourceNode === undefined) {
      continue;
    }

    const source = stringNodeValue(sourceNode);

    if (calleeNode.type === "import") {
      imports.push(
        createImport({
          kind: "dynamic",
          source,
          typeOnly: false,
          lineRange: toLineRange(callNode),
        }),
      );
      continue;
    }

    if (calleeNode.type !== "identifier" || calleeNode.text !== "require") {
      continue;
    }

    const bindings = requireBindings(callNode);
    if (bindings.length === 0) {
      imports.push(
        createImport({
          kind: "commonjs",
          source,
          typeOnly: false,
          lineRange: toLineRange(callNode),
        }),
      );
      continue;
    }

    for (const binding of bindings) {
      imports.push(
        createImport({
          kind: "commonjs",
          source,
          importedName: binding.importedName,
          localName: binding.localName,
          typeOnly: false,
          lineRange: toLineRange(binding.node),
        }),
      );
    }
  }

  return imports.sort(compareByLineRange);
}

function extractExports(rootNode: Parser.SyntaxNode): ParsedExport[] {
  const exports: ParsedExport[] = [];

  for (const exportNode of rootNode.descendantsOfType("export_statement")) {
    const sourceNode = exportNode.childForFieldName("source");
    const source = sourceNode === null ? undefined : stringNodeValue(sourceNode);
    const statementTypeOnly = hasDirectChild(exportNode, "type");
    const isDefault = hasDirectChild(exportNode, "default");
    const declaration = exportNode.childForFieldName("declaration");

    if (declaration !== null) {
      for (const binding of declarationBindings(declaration)) {
        exports.push(
          createExport({
            kind: isDefault ? "default" : "named",
            exportedName: isDefault ? "default" : binding.name,
            localName: binding.name,
            typeOnly:
              statementTypeOnly || TYPE_DECLARATION_TYPES.has(declaration.type),
            lineRange: toLineRange(binding.node),
          }),
        );
      }

      continue;
    }

    const exportClause = exportNode.namedChildren.find(
      (child) => child.type === "export_clause",
    );

    if (exportClause !== undefined) {
      for (const specifier of exportClause.namedChildren) {
        if (specifier.type !== "export_specifier") {
          continue;
        }

        const localNameNode = specifier.childForFieldName("name");
        if (localNameNode === null) {
          continue;
        }

        const aliasNode = specifier.childForFieldName("alias");
        const localName = nodeName(localNameNode);
        exports.push(
          createExport({
            kind: "named",
            exportedName: aliasNode === null ? localName : nodeName(aliasNode),
            localName,
            ...(source === undefined ? {} : { source }),
            typeOnly:
              statementTypeOnly || hasDirectChild(specifier, "type"),
            lineRange: toLineRange(specifier),
          }),
        );
      }

      continue;
    }

    const namespaceExport = exportNode.namedChildren.find(
      (child) => child.type === "namespace_export",
    );

    if (namespaceExport !== undefined) {
      const exportedNameNode = namespaceExport.namedChildren[0];
      if (exportedNameNode !== undefined) {
        exports.push(
          createExport({
            kind: "namespace",
            exportedName: nodeName(exportedNameNode),
            ...(source === undefined ? {} : { source }),
            typeOnly: statementTypeOnly,
            lineRange: toLineRange(namespaceExport),
          }),
        );
      }

      continue;
    }

    const value = exportNode.childForFieldName("value");
    if (isDefault && value !== null) {
      const localName = exportedValueName(value);
      exports.push(
        createExport({
          kind: "default",
          exportedName: "default",
          ...(localName === undefined ? {} : { localName }),
          typeOnly: false,
          lineRange: toLineRange(value),
        }),
      );
      continue;
    }

    if (source !== undefined) {
      exports.push(
        createExport({
          kind: "all",
          exportedName: "*",
          source,
          typeOnly: statementTypeOnly,
          lineRange: toLineRange(exportNode),
        }),
      );
    }
  }

  for (const assignment of rootNode.descendantsOfType("assignment_expression")) {
    const target = commonJsExportTarget(assignment);
    const valueNode = assignment.childForFieldName("right");
    if (target === undefined || valueNode === null) {
      continue;
    }

    exports.push(
      createExport({
        kind: target.kind,
        exportedName: target.exportedName,
        ...(valueNode.type === "identifier"
          ? { localName: valueNode.text }
          : {}),
        typeOnly: false,
        lineRange: toLineRange(assignment),
      }),
    );
  }

  return exports.sort(compareByLineRange);
}

function extractSymbols(
  rootNode: Parser.SyntaxNode,
  exportedLocalNames: ReadonlySet<string>,
): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];

  walkNamed(rootNode, (node) => {
    if (node.type === "variable_declarator" && isTopLevelVariable(node)) {
      const nameNode = node.childForFieldName("name");
      const valueNode = node.childForFieldName("value");
      if (
        nameNode?.type === "identifier" &&
        valueNode !== null &&
        !FUNCTION_EXPRESSION_TYPES.has(valueNode.type) &&
        !CLASS_TYPES.has(valueNode.type)
      ) {
        symbols.push({
          type: "variable",
          name: nameNode.text,
          exported:
            isDirectVariableExport(node) ||
            exportedLocalNames.has(nameNode.text),
          lineRange: toLineRange(node),
        });
      }
      return;
    }

    const symbolType = symbolTypeForNode(node);
    if (symbolType === undefined) {
      return;
    }

    const name = symbolNameForNode(node);
    if (name === undefined) {
      return;
    }

    const exported =
      !METHOD_TYPES.has(node.type) &&
      (isDirectModuleExport(node) ||
        (isTopLevelSymbol(node) && exportedLocalNames.has(name)));

    symbols.push({
      type: symbolType,
      name,
      exported,
      lineRange: toLineRange(node),
    });
  });

  return symbols;
}

function extractCalls(
  rootNode: Parser.SyntaxNode,
  importedLocalNames: ReadonlySet<string>,
  localFunctionNames: ReadonlySet<string>,
): ParsedCall[] {
  return rootNode.descendantsOfType("call_expression").flatMap((callNode) => {
    const calleeNode = callNode.childForFieldName("function");
    if (calleeNode === null) {
      return [];
    }

    const caller = enclosingCallableName(callNode);
    const call: ParsedCall = {
      callee: calleeNode.text,
      kind: callKindForNode(calleeNode),
      lineRange: toLineRange(callNode),
    };

    if (caller !== undefined) {
      call.caller = caller;
    }

    const importedLocalName = importedLocalNameForCall(
      callNode,
      calleeNode,
      importedLocalNames,
    );
    if (importedLocalName !== undefined) {
      call.importedLocalName = importedLocalName;
    }

    const localTargetName = localFunctionNameForCall(
      callNode,
      calleeNode,
      localFunctionNames,
    );
    if (localTargetName !== undefined) {
      call.localTargetName = localTargetName;
    }

    return [call];
  });
}

function uniqueFunctionSymbolNames(
  symbols: readonly ParsedSymbol[],
): Set<string> {
  const counts = new Map<string, number>();
  for (const symbol of symbols) {
    if (symbol.type !== "function") continue;
    counts.set(symbol.name, (counts.get(symbol.name) ?? 0) + 1);
  }
  return new Set(
    [...counts].flatMap(([name, count]) => count === 1 ? [name] : []),
  );
}

function localFunctionNameForCall(
  callNode: Parser.SyntaxNode,
  calleeNode: Parser.SyntaxNode,
  localFunctionNames: ReadonlySet<string>,
): string | undefined {
  if (
    calleeNode.type !== "identifier" ||
    !localFunctionNames.has(calleeNode.text)
  ) {
    return undefined;
  }

  const name = calleeNode.text;
  let current = callNode.parent;
  while (current !== null) {
    if (isCallableNode(current)) {
      for (const fieldName of ["parameter", "parameters"] as const) {
        const parameters = current.childForFieldName(fieldName);
        if (parameters !== null && bindingPatternContainsName(parameters, name)) {
          return undefined;
        }
      }
      if (symbolNameForNode(current) === name) return name;
      const body = current.childForFieldName("body");
      const binding = body === null ? undefined : bodyBindingKind(body, name);
      if (binding !== undefined) return binding === "function" ? name : undefined;
    } else if (current.type === "program") {
      const binding = bodyBindingKind(current, name);
      return binding === "function" ? name : undefined;
    }
    current = current.parent;
  }
  return undefined;
}

function bodyBindingKind(
  node: Parser.SyntaxNode,
  name: string,
): "function" | "other" | undefined {
  for (const child of node.namedChildren) {
    if (FUNCTION_DECLARATION_TYPES.has(child.type)) {
      if (child.childForFieldName("name")?.text === name) return "function";
      continue;
    }
    if (isCallableNode(child)) continue;
    if (CLASS_TYPES.has(child.type)) {
      if (child.childForFieldName("name")?.text === name) return "other";
      continue;
    }
    if (child.type === "variable_declarator") {
      const binding = child.childForFieldName("name");
      if (binding !== null && bindingPatternContainsName(binding, name)) {
        const value = child.childForFieldName("value");
        return value !== null && isCallableNode(value) ? "function" : "other";
      }
    }
    if (child.type === "catch_clause") {
      const parameter = child.childForFieldName("parameter");
      if (parameter !== null && bindingPatternContainsName(parameter, name)) {
        return "other";
      }
    }
    const nested = bodyBindingKind(child, name);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function extractEntryPoints(
  filePath: string,
  rootNode: Parser.SyntaxNode,
  symbols: readonly ParsedSymbol[],
  imports: readonly ParsedImport[],
  exports: readonly ParsedExport[],
  conventions: JavaScriptConventionIndex,
): ParsedEntryPoint[] {
  const entrypoints: ParsedEntryPoint[] = [];
  const httpReceivers = classifiedHttpReceiverAliases(rootNode, conventions);
  const callableNames = knownCallableNames(symbols, imports);

  for (const callNode of rootNode.descendantsOfType("call_expression")) {
    const entrypoint = entryPointForCall(
      callNode,
      httpReceivers,
      callableNames,
      conventions,
    );
    if (entrypoint !== undefined) {
      entrypoints.push(entrypoint);
    }
  }

  entrypoints.push(...exportedApplicationEntryPoints(symbols, exports, conventions));
  entrypoints.push(
    ...exportedLifecycleEntryPoints(filePath, symbols, exports, conventions),
  );
  entrypoints.push(...startupSymbolEntryPoints(symbols, conventions));
  entrypoints.push(...reactDomBootstrapEntryPoints(rootNode, imports));
  entrypoints.push(...fileRouteEntryPoints(filePath, symbols, exports));

  const seen = new Set<string>();
  return entrypoints.sort(compareEntryPoints).filter((entrypoint) => {
    const key = [
      entrypoint.kind,
      entrypoint.name,
      entrypoint.handlerName ?? "",
      entrypoint.httpMethod ?? "",
      entrypoint.route ?? "",
      entrypoint.lineRange.start,
      entrypoint.lineRange.end,
    ].join("\u0000");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function extractFrameworkDiagnostics(
  rootNode: Parser.SyntaxNode,
  entrypoints: readonly ParsedEntryPoint[],
  symbols: readonly ParsedSymbol[],
  imports: readonly ParsedImport[],
  conventions: JavaScriptConventionIndex,
): NonNullable<ParsedSourceFile["frameworkDiagnostics"]> {
  const httpReceivers = classifiedHttpReceiverAliases(rootNode, conventions);
  const callableNames = knownCallableNames(symbols, imports);
  const resolvedLines = new Set(entrypoints.map((entrypoint) => entrypoint.lineRange.start));
  const diagnostics: NonNullable<ParsedSourceFile["frameworkDiagnostics"]> = [];
  for (const callNode of rootNode.descendantsOfType("call_expression")) {
    if (resolvedLines.has(toLineRange(callNode).start)) continue;
    const calleeNode = callNode.childForFieldName("function");
    if (calleeNode === null) continue;
    const memberPath = staticMemberPath(calleeNode);
    const method = memberPath?.at(-1);
    const argumentsNode = callNode.childForFieldName("arguments");
    const argumentsList = argumentsNode?.namedChildren ?? [];
    const trigger = argumentsList[0] === undefined
      ? undefined
      : staticLiteralValue(argumentsList[0]);
    const handler = argumentsList.at(-1);
    const receiver = memberPath?.[0];
    const hasHandler = handler !== undefined && isHandlerArgument(handler);
    const hasProvenHandler = handler !== undefined &&
      isProvenHandlerArgument(handler, callableNames);
    const decoratorLike = isInsideDecorator(callNode) &&
      /(?:Endpoint|Handler|Route)$/u.test(calleeNode.text);
    const conventionalServerReceiver = receiver !== undefined &&
      (httpReceivers.server.has(receiver) || conventions.httpReceivers.has(receiver));
    const registrationLike = memberPath !== undefined && memberPath.length >= 2 &&
      receiver !== undefined &&
      !httpReceivers.nonServerFactory.has(receiver) &&
      method !== undefined && trigger !== undefined &&
      (hasProvenHandler || (conventionalServerReceiver && hasHandler)) &&
      (conventions.httpMethods.has(method) || conventions.websocketMethods.has(method));
    if (!decoratorLike && !registrationLike) continue;
    diagnostics.push({
      kind: decoratorLike ? "unresolved-decorator" : "unresolved-registration",
      message: decoratorLike
        ? `Unrecognized entrypoint-like decorator: ${calleeNode.text}`
        : `Unrecognized route receiver in registration: ${calleeNode.text}`,
      lineRange: toLineRange(callNode),
    });
  }
  return diagnostics.sort(compareByLineRange);
}

function fileRouteEntryPoints(
  filePath: string,
  symbols: readonly ParsedSymbol[],
  exports: readonly ParsedExport[],
): ParsedEntryPoint[] {
  const routeFile = frameworkRouteFile(filePath);
  if (routeFile === undefined) return [];
  const entrypoints: ParsedEntryPoint[] = [];

  if (routeFile.kind === "http") {
    for (const parsedExport of exports) {
      if (parsedExport.typeOnly || parsedExport.source !== undefined) continue;
      const localName = parsedExport.localName ?? parsedExport.exportedName;
      const exportedName = parsedExport.exportedName;
      const method = /^(?:DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT)$/u.test(exportedName)
        ? exportedName
        : exportedName === "loader"
          ? "GET"
          : exportedName === "action"
            ? "POST"
            : undefined;
      if (method === undefined && exportedName !== "default") continue;
      const handler = symbols.find((symbol) =>
        symbol.type === "function" && symbol.name === localName
      );
      entrypoints.push({
        kind: "http",
        name: `${method ?? "HTTP"} ${routeFile.route}`,
        exposure: "external",
        ...(method === undefined ? {} : { httpMethod: method }),
        route: routeFile.route,
        ...(handler === undefined ? {} : { handlerName: handler.name }),
        lineRange: { ...parsedExport.lineRange },
      });
    }
    return entrypoints;
  }

  const defaultExport = exports.find((item) =>
    !item.typeOnly && item.source === undefined && item.exportedName === "default"
  );
  const localName = defaultExport?.localName;
  const handler = localName === undefined
    ? undefined
    : symbols.find((symbol) => symbol.type === "function" && symbol.name === localName);
  const lineRange = defaultExport?.lineRange ?? symbols[0]?.lineRange ?? { start: 1, end: 1 };
  const pageKind = /(?:^|\/)_layout\.[^.]+$/u.test(filePath.replaceAll("\\", "/"))
    ? "LAYOUT"
    : "PAGE";
  return [{
    kind: "application",
    name: `${pageKind} ${routeFile.route}`,
    exposure: "external",
    ...(handler === undefined ? {} : { handlerName: handler.name }),
    lineRange: { ...lineRange },
  }];
}

function frameworkRouteFile(
  filePath: string,
): { kind: "http" | "page"; route: string } | undefined {
  const path = filePath.replaceAll("\\", "/");
  const nextApp = /(?:^|\/)app\/(.*?)(?:\/)?(route|page)\.[cm]?[jt]sx?$/u.exec(path);
  if (nextApp !== null) {
    return {
      kind: nextApp[2] === "route" ? "http" : "page",
      route: routeFromSegments(nextApp[1] ?? ""),
    };
  }
  const nextApi = /(?:^|\/)pages\/api\/(.*?)\.[cm]?[jt]sx?$/u.exec(path);
  if (nextApi !== null) {
    return { kind: "http", route: `/api${routeFromSegments(nextApi[1] ?? "")}` };
  }
  const svelteKit = /(?:^|\/)src\/routes\/(.*?)(?:\/)?\+(server|page)\.(?:[cm]?[jt]s|svelte)$/u.exec(path);
  if (svelteKit !== null) {
    return {
      kind: svelteKit[2] === "server" ? "http" : "page",
      route: routeFromSegments(svelteKit[1] ?? ""),
    };
  }
  const remix = /(?:^|\/)app\/routes\/(.*?)\.[cm]?[jt]sx?$/u.exec(path);
  if (remix !== null) {
    return { kind: "http", route: routeFromRemixName(remix[1] ?? "") };
  }
  const expo = /(?:^|\/)app\/(.*?)(?:\/)?(?:index|_layout)\.[cm]?[jt]sx?$/u.exec(path);
  if (expo !== null && !/(?:^|\/)app\/.*\/route\.[cm]?[jt]sx?$/u.test(path)) {
    return { kind: "page", route: routeFromSegments(expo[1] ?? "") };
  }
  const filePage = /(?:^|\/)(?:src\/)?pages\/(.*?)\.(?:astro|vue)$/u.exec(path);
  if (filePage !== null) {
    const pageName = (filePage[1] ?? "").replace(/(?:^|\/)index$/u, "");
    return { kind: "page", route: routeFromSegments(pageName) };
  }
  return undefined;
}

function routeFromSegments(value: string): string {
  const segments = value.split("/").filter((segment) =>
    segment.length > 0 && !/^\(.*\)$/u.test(segment)
  ).map((segment) => {
    const catchAll = /^\[\.\.\.(.+)\]$/u.exec(segment);
    if (catchAll !== null) return `*${catchAll[1] ?? "path"}`;
    const dynamic = /^\[(.+)\]$/u.exec(segment);
    return dynamic === null ? segment : `:${dynamic[1] ?? "param"}`;
  });
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function routeFromRemixName(value: string): string {
  const normalized = value
    .replace(/^_index$/u, "")
    .replaceAll(".", "/")
    .split("/")
    .filter((segment) => !segment.startsWith("_"))
    .map((segment) => segment.startsWith("$") ? `:${segment.slice(1)}` : segment)
    .join("/");
  return normalized.length === 0 ? "/" : `/${normalized}`;
}

function extractEvents(
  rootNode: Parser.SyntaxNode,
  conventions: JavaScriptConventionIndex,
): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  for (const callNode of rootNode.descendantsOfType("call_expression")) {
    const calleeNode = callNode.childForFieldName("function");
    const memberPath = calleeNode === null ? undefined : staticMemberPath(calleeNode);
    if (memberPath === undefined || memberPath.length < 2) continue;

    const method = memberPath.at(-1);
    const argumentsNode = callNode.childForFieldName("arguments");
    if (method === undefined) continue;
    const operation = eventOperationForMethod(method, conventions);
    if (operation === undefined) continue;
    const name = eventNameFromArguments(argumentsNode?.namedChildren ?? []);
    if (name === undefined) continue;

    const ownerName = enclosingCallableName(callNode);
    events.push({
      name,
      operation,
      ...(ownerName === undefined ? {} : { ownerName }),
      lineRange: toLineRange(callNode),
    });
  }
  return events.sort(compareByLineRange);
}

function eventOperationForMethod(
  method: string,
  conventions: JavaScriptConventionIndex,
): ParsedEvent["operation"] | undefined {
  if (conventions.eventSubscribeMethods.has(method)) return "subscribe";
  if (
    conventions.eventPublishMethods.has(method) ||
    /^(?:emit|publish|dispatch)[A-Z_]/u.test(method)
  ) {
    return "publish";
  }
  return undefined;
}

function eventNameFromArguments(
  argumentsList: readonly Parser.SyntaxNode[],
): string | undefined {
  for (const argument of argumentsList) {
    const literal = staticLiteralValue(argument);
    if (literal !== undefined) return literal;
  }
  for (const argument of argumentsList) {
    if (argument.type !== "object") continue;
    const type = staticObjectProperty(argument, "type");
    if (type !== undefined) return type;
  }
  return undefined;
}

function extractRenders(rootNode: Parser.SyntaxNode): ParsedRender[] {
  const nodes = [
    ...rootNode.descendantsOfType("jsx_opening_element"),
    ...rootNode.descendantsOfType("jsx_self_closing_element"),
  ];
  return nodes
    .flatMap((node) => {
      const nameNode = node.childForFieldName("name");
      const componentName = nameNode?.text;
      if (componentName === undefined || !/^\p{Lu}/u.test(componentName)) {
        return [];
      }
      const ownerName = enclosingCallableName(node);
      return [{
        componentName,
        ...(ownerName === undefined ? {} : { ownerName }),
        lineRange: toLineRange(node),
      }];
    })
    .sort(compareByLineRange);
}

function extractJsxValueReferences(
  rootNode: Parser.SyntaxNode,
): ParsedReference[] {
  return rootNode.descendantsOfType("jsx_attribute")
    .flatMap((attribute) => {
      const value = attribute.childForFieldName("value") ??
        attribute.namedChildren.find((child) => child.type === "jsx_expression");
      const expression = value?.type === "jsx_expression"
        ? value.namedChildren[0]
        : undefined;
      if (expression?.type !== "identifier") return [];
      const ownerName = enclosingCallableName(attribute);
      return [{
        targetName: expression.text,
        ...(ownerName === undefined ? {} : { ownerName }),
        lineRange: toLineRange(attribute),
      }];
    })
    .sort(compareByLineRange);
}

function entryPointForCall(
  callNode: Parser.SyntaxNode,
  httpReceivers: HttpReceiverAliases,
  callableNames: ReadonlySet<string>,
  conventions: JavaScriptConventionIndex,
): ParsedEntryPoint | undefined {
  const calleeNode = callNode.childForFieldName("function");
  if (calleeNode === null) {
    return undefined;
  }

  if (isInsideDecorator(callNode) && calleeNode.type === "identifier") {
    return decoratorEntryPoint(callNode, calleeNode.text, conventions);
  }

  const memberPath = staticMemberPath(calleeNode);
  if (memberPath === undefined || memberPath.length < 2) {
    return undefined;
  }

  const receiver = memberPath[0];
  const method = memberPath[memberPath.length - 1];
  if (receiver === undefined || method === undefined) {
    return undefined;
  }

  const argumentsNode = callNode.childForFieldName("arguments");
  const argumentsList = argumentsNode?.namedChildren ?? [];
  const triggerNode = argumentsList[0];
  const trigger =
    triggerNode === undefined ? undefined : staticLiteralValue(triggerNode);
  const handlerNode = argumentsList[argumentsList.length - 1];
  const provenHttpReceiver = httpReceivers.server.has(receiver);
  const httpReceiver = provenHttpReceiver ||
    (conventions.httpReceivers.has(receiver) &&
      !httpReceivers.nonServerFactory.has(receiver));
  const hasHandler =
    argumentsList.length >= 2 &&
    handlerNode !== undefined &&
    isHandlerArgument(handlerNode);
  const hasProvenHttpHandler =
    hasHandler &&
    handlerNode !== undefined &&
    (provenHttpReceiver || isProvenHandlerArgument(handlerNode, callableNames));
  const handlerName =
    hasHandler && handlerNode !== undefined
      ? handlerNameForArgument(handlerNode)
      : undefined;

  if (
    httpReceiver &&
    (provenHttpReceiver || conventions.startupReceivers.has(receiver)) &&
    method === "listen"
  ) {
    return createParsedEntryPoint(
      "startup",
      "listen",
      callNode,
      undefined,
      { exposure: "startup" },
    );
  }

  if (
    httpReceiver &&
    conventions.websocketMethods.has(method) &&
    trigger !== undefined &&
    hasProvenHttpHandler
  ) {
    return createParsedEntryPoint(
      "websocket",
      `WS ${trigger}`,
      callNode,
      handlerName,
      { httpMethod: "GET", route: trigger },
    );
  }

  if (httpReceiver && method === "route") {
    return routeObjectEntryPoint(callNode, argumentsList[0]);
  }

  if (
    httpReceiver &&
    conventions.httpMethods.has(method) &&
    trigger !== undefined &&
    hasProvenHttpHandler
  ) {
    const httpMethod = method.toUpperCase();
    const websocket = objectHasBooleanProperty(argumentsList[1], "websocket", true);
    return createParsedEntryPoint(
      websocket ? "websocket" : "http",
      `${websocket ? "WS" : httpMethod} ${trigger}`,
      callNode,
      handlerName,
      { httpMethod, route: trigger },
    );
  }

  if (
    conventions.cliReceivers.has(receiver) &&
    method === "command" &&
    trigger !== undefined
  ) {
    return createParsedEntryPoint(
      "cli",
      trigger,
      callNode,
      handlerName,
    );
  }

  if (
    conventions.eventReceivers.has(receiver) &&
    conventions.eventSubscribeMethods.has(method) &&
    trigger !== undefined &&
    hasHandler
  ) {
    return createParsedEntryPoint(
      "event",
      trigger,
      callNode,
      handlerName,
    );
  }

  if (
    conventions.scheduleReceivers.has(receiver) &&
    conventions.scheduleMethods.has(method) &&
    trigger !== undefined &&
    hasHandler
  ) {
    return createParsedEntryPoint(
      "scheduled",
      trigger,
      callNode,
      handlerName,
    );
  }

  const graphqlOperation = conventions.graphqlMethods[method];
  if (
    conventions.graphqlReceivers.has(receiver) &&
    graphqlOperation !== undefined &&
    trigger !== undefined &&
    hasHandler
  ) {
    return createParsedEntryPoint(
      "graphql",
      `${graphqlOperation} ${trigger}`,
      callNode,
      handlerName,
    );
  }

  return undefined;
}

interface HttpReceiverAliases {
  server: Set<string>;
  nonServerFactory: Set<string>;
}

function classifiedHttpReceiverAliases(
  rootNode: Parser.SyntaxNode,
  conventions: JavaScriptConventionIndex,
): HttpReceiverAliases {
  const server = new Set<string>();
  const nonServerFactory = new Set<string>();
  for (const declarator of rootNode.descendantsOfType("variable_declarator")) {
    const nameNode = declarator.childForFieldName("name");
    const valueNode = unwrapAwaitExpression(declarator.childForFieldName("value"));
    if (nameNode?.type !== "identifier" || valueNode === undefined) continue;
    const callableNode = valueNode.type === "call_expression"
      ? valueNode.childForFieldName("function")
      : valueNode.type === "new_expression"
        ? valueNode.childForFieldName("constructor")
        : null;
    const factoryPath = callableNode === null ? undefined : staticMemberPath(callableNode);
    const factoryName = factoryPath?.join(".");
    const unqualifiedFactory = factoryPath?.at(-1);
    if (
      (factoryName !== undefined && conventions.httpFactoryNames.has(factoryName)) ||
      (unqualifiedFactory !== undefined && conventions.httpFactoryNames.has(unqualifiedFactory))
    ) {
      server.add(nameNode.text);
    } else if (
      callableNode !== null &&
      conventions.httpReceivers.has(nameNode.text)
    ) {
      // A conventional name created by an unrecognized factory is not enough
      // to prove a server. This is the common shape of outbound HTTP clients
      // such as `const api = clientLibrary.create(...)`.
      nonServerFactory.add(nameNode.text);
    }
  }

  for (const callNode of rootNode.descendantsOfType("call_expression")) {
    const calleeNode = callNode.childForFieldName("function");
    const memberPath = calleeNode === null ? undefined : staticMemberPath(calleeNode);
    const receiver = memberPath?.[0];
    if (
      receiver !== undefined &&
      memberPath?.at(-1) === "listen" &&
      conventions.startupReceivers.has(receiver) &&
      !nonServerFactory.has(receiver)
    ) {
      server.add(receiver);
    }
  }
  let changed = true;

  while (changed) {
    changed = false;
    for (const callNode of rootNode.descendantsOfType("call_expression")) {
      const calleeNode = callNode.childForFieldName("function");
      const memberPath = calleeNode === null ? undefined : staticMemberPath(calleeNode);
      if (
        memberPath === undefined ||
        memberPath.length < 2 ||
        memberPath.at(-1) !== "register" ||
        (!server.has(memberPath[0] ?? "") &&
          (!conventions.httpReceivers.has(memberPath[0] ?? "") ||
            nonServerFactory.has(memberPath[0] ?? "")))
      ) {
        continue;
      }

      const argumentsNode = callNode.childForFieldName("arguments");
      for (const argument of argumentsNode?.namedChildren ?? []) {
        if (!FUNCTION_EXPRESSION_TYPES.has(argument.type)) continue;
        const parametersNode = argument.childForFieldName("parameters");
        const firstParameter = parametersNode?.namedChildren[0];
        const firstParameterName =
          firstParameter?.type === "identifier"
            ? firstParameter.text
            : firstParameter?.childForFieldName("pattern")?.type === "identifier"
              ? firstParameter.childForFieldName("pattern")?.text
              : undefined;
        if (
          firstParameterName !== undefined &&
          !server.has(firstParameterName)
        ) {
          server.add(firstParameterName);
          changed = true;
        }
      }
    }
  }

  return { server, nonServerFactory };
}

function unwrapAwaitExpression(
  node: Parser.SyntaxNode | null,
): Parser.SyntaxNode | undefined {
  let current = node ?? undefined;
  while (current?.type === "await_expression" || current?.type === "parenthesized_expression") {
    current = current.namedChildren[0];
  }
  return current;
}

function decoratorEntryPoint(
  callNode: Parser.SyntaxNode,
  decoratorName: string,
  conventions: JavaScriptConventionIndex,
): ParsedEntryPoint | undefined {
  const handlerName = decoratedCallableName(callNode);
  if (handlerName === undefined) {
    return undefined;
  }

  const argumentsNode = callNode.childForFieldName("arguments");
  const firstArgument = argumentsNode?.namedChildren[0];
  const trigger =
    firstArgument === undefined ? undefined : staticLiteralValue(firstArgument);

  if (firstArgument !== undefined && trigger === undefined) {
    return undefined;
  }

  const httpMethod = conventions.httpDecorators[decoratorName];
  if (httpMethod !== undefined) {
    return createParsedEntryPoint(
      "http",
      trigger === undefined ? httpMethod : `${httpMethod} ${trigger}`,
      callNode,
      handlerName,
      {
        ...(trigger === undefined ? {} : { route: trigger }),
        httpMethod,
      },
    );
  }

  const graphqlOperation = conventions.graphqlDecorators[decoratorName];
  if (graphqlOperation !== undefined) {
    const operationName = trigger ?? unqualifiedSymbolName(handlerName);
    return createParsedEntryPoint(
      "graphql",
      `${graphqlOperation} ${operationName}`,
      callNode,
      handlerName,
    );
  }

  if (conventions.scheduleDecorators.has(decoratorName) && trigger !== undefined) {
    return createParsedEntryPoint(
      "scheduled",
      `${decoratorName} ${trigger}`,
      callNode,
      handlerName,
    );
  }

  if (conventions.eventDecorators.has(decoratorName) && trigger !== undefined) {
    return createParsedEntryPoint(
      "event",
      trigger,
      callNode,
      handlerName,
    );
  }

  return undefined;
}

function decoratedCallableName(
  callNode: Parser.SyntaxNode,
): string | undefined {
  let decoratorNode = callNode.parent;

  while (decoratorNode !== null && decoratorNode.type !== "decorator") {
    decoratorNode = decoratorNode.parent;
  }

  const container = decoratorNode?.parent;
  if (decoratorNode === null || container === undefined || container === null) {
    return undefined;
  }

  const decoratorIndex = container.namedChildren.findIndex(
    (child) => child.id === decoratorNode.id,
  );
  if (decoratorIndex === -1) {
    return undefined;
  }

  for (const sibling of container.namedChildren.slice(decoratorIndex + 1)) {
    if (sibling.type === "decorator") {
      continue;
    }

    return isCallableNode(sibling) ? symbolNameForNode(sibling) : undefined;
  }

  return undefined;
}

function exportedApplicationEntryPoints(
  symbols: readonly ParsedSymbol[],
  exports: readonly ParsedExport[],
  conventions: JavaScriptConventionIndex,
): ParsedEntryPoint[] {
  const entrypoints: ParsedEntryPoint[] = [];

  for (const parsedExport of exports) {
    const localName = parsedExport.localName ?? parsedExport.exportedName;
    const entrypointName = conventions.exportedApplicationHandlerNames.has(
      parsedExport.exportedName,
    )
      ? parsedExport.exportedName
      : conventions.exportedApplicationHandlerNames.has(localName)
        ? localName
        : undefined;

    if (
      parsedExport.typeOnly ||
      parsedExport.source !== undefined ||
      entrypointName === undefined
    ) {
      continue;
    }

    const candidates = symbols.filter(
      (symbol) =>
        symbol.type === "function" &&
        symbol.exported &&
        symbol.name === localName,
    );
    if (candidates.length !== 1) {
      continue;
    }

    entrypoints.push({
      kind: "application",
      name: entrypointName,
      exposure: "external",
      handlerName: localName,
      lineRange: {
        start: parsedExport.lineRange.start,
        end: parsedExport.lineRange.end,
      },
    });
  }

  return entrypoints;
}

function exportedLifecycleEntryPoints(
  filePath: string,
  symbols: readonly ParsedSymbol[],
  exports: readonly ParsedExport[],
  conventions: JavaScriptConventionIndex,
): ParsedEntryPoint[] {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const entrypoints: ParsedEntryPoint[] = [];

  for (const convention of conventions.lifecycleExports) {
    convention.pathPattern.lastIndex = 0;
    if (!convention.pathPattern.test(normalizedPath)) continue;

    const exportedNames = new Set(convention.exportedNames);
    for (const parsedExport of exports) {
      if (
        parsedExport.typeOnly ||
        parsedExport.source !== undefined ||
        !exportedNames.has(parsedExport.exportedName)
      ) {
        continue;
      }
      const localName = parsedExport.localName ?? parsedExport.exportedName;
      const handlers = symbols.filter((symbol) =>
        symbol.type === "function" &&
        symbol.exported &&
        symbol.name === localName
      );
      if (handlers.length !== 1) continue;

      entrypoints.push({
        kind: "startup",
        name: `${convention.namePrefix} ${parsedExport.exportedName}`,
        exposure: "startup",
        handlerName: localName,
        lineRange: { ...parsedExport.lineRange },
      });
    }
  }

  return entrypoints;
}

function startupSymbolEntryPoints(
  symbols: readonly ParsedSymbol[],
  conventions: JavaScriptConventionIndex,
): ParsedEntryPoint[] {
  return symbols.flatMap((symbol) => {
    if (symbol.type !== "function" || !conventions.startupSymbolNames.has(symbol.name)) {
      return [];
    }

    return [{
      kind: "startup" as const,
      name: symbol.name,
      exposure: "startup" as const,
      handlerName: symbol.name,
      lineRange: { ...symbol.lineRange },
    }];
  });
}

function reactDomBootstrapEntryPoints(
  rootNode: Parser.SyntaxNode,
  imports: readonly ParsedImport[],
): ParsedEntryPoint[] {
  return rootNode.descendantsOfType("call_expression").flatMap((callNode) => {
    const calleeNode = callNode.childForFieldName("function");
    const method = calleeNode === null
      ? undefined
      : reactDomBootstrapMethod(callNode, calleeNode, imports);
    if (method === undefined) return [];
    return [{
      kind: "startup" as const,
      name: `React ${method}`,
      exposure: "startup" as const,
      lineRange: toLineRange(callNode),
    }];
  });
}

function reactDomBootstrapMethod(
  callNode: Parser.SyntaxNode,
  calleeNode: Parser.SyntaxNode,
  imports: readonly ParsedImport[],
): string | undefined {
  const memberPath = staticMemberPath(calleeNode);
  if (memberPath === undefined || memberPath.length === 0) return undefined;

  if (memberPath.length === 1) {
    const localName = memberPath[0];
    if (
      localName === undefined ||
      hasEnclosingCallableBinding(callNode, localName)
    ) {
      return undefined;
    }
    const matches = imports.filter(
      (parsedImport) =>
        !parsedImport.typeOnly &&
        REACT_DOM_MODULES.has(parsedImport.source) &&
        parsedImport.localName === localName &&
        parsedImport.importedName !== undefined &&
        REACT_DOM_BOOTSTRAP_METHODS.has(parsedImport.importedName),
    );
    return matches.length === 1 ? matches[0]?.importedName : undefined;
  }

  if (memberPath.length !== 2) return undefined;
  const receiver = memberPath[0];
  const method = memberPath[1];
  if (
    receiver === undefined ||
    method === undefined ||
    hasEnclosingCallableBinding(callNode, receiver) ||
    !REACT_DOM_BOOTSTRAP_METHODS.has(method)
  ) {
    return undefined;
  }
  const matches = imports.filter(
    (parsedImport) =>
      !parsedImport.typeOnly &&
      REACT_DOM_MODULES.has(parsedImport.source) &&
      parsedImport.localName === receiver &&
      (parsedImport.kind === "default" ||
        parsedImport.kind === "namespace" ||
        (parsedImport.kind === "commonjs" && parsedImport.importedName === "*")),
  );
  return matches.length === 1 ? method : undefined;
}

function routeObjectEntryPoint(
  callNode: Parser.SyntaxNode,
  routeOptions: Parser.SyntaxNode | undefined,
): ParsedEntryPoint | undefined {
  if (routeOptions?.type !== "object") {
    return undefined;
  }

  const method = staticObjectProperty(routeOptions, "method");
  const route =
    staticObjectProperty(routeOptions, "url") ??
    staticObjectProperty(routeOptions, "path");
  const handlerNode = objectPropertyValue(routeOptions, "handler");
  const handlerName =
    handlerNode !== undefined && isHandlerArgument(handlerNode)
      ? handlerNameForArgument(handlerNode)
      : undefined;

  if (method === undefined || route === undefined || handlerNode === undefined) {
    return undefined;
  }

  const httpMethod = method.toUpperCase();
  const websocket = objectHasBooleanProperty(routeOptions, "websocket", true);
  return createParsedEntryPoint(
    websocket ? "websocket" : "http",
    `${websocket ? "WS" : httpMethod} ${route}`,
    callNode,
    handlerName,
    { httpMethod, route },
  );
}

function createParsedEntryPoint(
  kind: ParsedEntryPointKind,
  name: string,
  node: Parser.SyntaxNode,
  handlerName: string | undefined,
  details: {
    exposure?: "external" | "startup";
    httpMethod?: string;
    route?: string;
  } = {},
): ParsedEntryPoint {
  return {
    kind,
    name,
    exposure: details.exposure ?? "external",
    ...(details.httpMethod === undefined
      ? {}
      : { httpMethod: details.httpMethod }),
    ...(details.route === undefined ? {} : { route: details.route }),
    ...(handlerName === undefined ? {} : { handlerName }),
    lineRange: toLineRange(node),
  };
}

function objectPropertyValue(
  objectNode: Parser.SyntaxNode | undefined,
  propertyName: string,
): Parser.SyntaxNode | undefined {
  if (objectNode?.type !== "object") {
    return undefined;
  }

  for (const child of objectNode.namedChildren) {
    if (child.type !== "pair") {
      continue;
    }

    const key = child.childForFieldName("key");
    const value = child.childForFieldName("value");
    if (key !== null && value !== null && staticPropertyName(key) === propertyName) {
      return value;
    }
  }

  return undefined;
}

function staticObjectProperty(
  objectNode: Parser.SyntaxNode | undefined,
  propertyName: string,
): string | undefined {
  const value = objectPropertyValue(objectNode, propertyName);
  return value === undefined ? undefined : staticLiteralValue(value);
}

function objectHasBooleanProperty(
  objectNode: Parser.SyntaxNode | undefined,
  propertyName: string,
  expected: boolean,
): boolean {
  const value = objectPropertyValue(objectNode, propertyName);
  return value?.type === (expected ? "true" : "false");
}

function staticPropertyName(node: Parser.SyntaxNode): string | undefined {
  if (node.type === "property_identifier" || node.type === "identifier") {
    return node.text;
  }

  return node.type === "string" ? stringNodeValue(node) : undefined;
}

function staticLiteralValue(node: Parser.SyntaxNode): string | undefined {
  if (node.type === "string") {
    return stringNodeValue(node);
  }

  if (node.type === "number") {
    return node.text;
  }

  if (
    node.type === "template_string" &&
    !node.namedChildren.some((child) => child.type === "template_substitution")
  ) {
    return node.text.length >= 2 ? node.text.slice(1, -1) : node.text;
  }

  return undefined;
}

function isHandlerArgument(node: Parser.SyntaxNode): boolean {
  return (
    node.type === "identifier" ||
    node.type === "member_expression" ||
    node.type === "subscript_expression" ||
    FUNCTION_EXPRESSION_TYPES.has(node.type)
  );
}

function isProvenHandlerArgument(
  node: Parser.SyntaxNode,
  callableNames: ReadonlySet<string>,
): boolean {
  if (FUNCTION_EXPRESSION_TYPES.has(node.type)) return true;
  if (node.type === "identifier") return callableNames.has(node.text);
  if (node.type !== "member_expression" && node.type !== "subscript_expression") {
    return false;
  }
  const path = staticMemberPath(node);
  const rootName = path?.[0];
  return rootName !== undefined && callableNames.has(rootName);
}

function knownCallableNames(
  symbols: readonly ParsedSymbol[],
  imports: readonly ParsedImport[],
): Set<string> {
  return new Set([
    ...symbols
      .filter((symbol) => symbol.type === "function" || symbol.type === "class")
      .map((symbol) => symbol.name),
    ...imports.flatMap((parsedImport) =>
      parsedImport.typeOnly || parsedImport.localName === undefined
        ? []
        : [parsedImport.localName]
    ),
  ]);
}

function handlerNameForArgument(
  node: Parser.SyntaxNode,
): string | undefined {
  return node.type === "identifier" ? node.text : undefined;
}

function isInsideDecorator(node: Parser.SyntaxNode): boolean {
  let current = node.parent;

  while (current !== null) {
    if (current.type === "decorator") {
      return true;
    }

    if (current.type === "program") {
      return false;
    }

    current = current.parent;
  }

  return false;
}

function unqualifiedSymbolName(name: string): string {
  const separatorIndex = name.lastIndexOf(".");
  return separatorIndex === -1 ? name : name.slice(separatorIndex + 1);
}

function compareEntryPoints(
  left: ParsedEntryPoint,
  right: ParsedEntryPoint,
): number {
  return (
    left.lineRange.start - right.lineRange.start ||
    left.lineRange.end - right.lineRange.end ||
    compareStrings(left.kind, right.kind) ||
    compareStrings(left.name, right.name) ||
    compareStrings(left.httpMethod ?? "", right.httpMethod ?? "") ||
    compareStrings(left.route ?? "", right.route ?? "") ||
    compareStrings(left.handlerName ?? "", right.handlerName ?? "")
  );
}

function uniqueValueImportLocalNames(
  imports: readonly ParsedImport[],
): Set<string> {
  const counts = new Map<string, number>();

  for (const parsedImport of imports) {
    if (parsedImport.typeOnly || parsedImport.localName === undefined) {
      continue;
    }

    counts.set(
      parsedImport.localName,
      (counts.get(parsedImport.localName) ?? 0) + 1,
    );
  }

  return new Set(
    [...counts].flatMap(([localName, count]) =>
      count === 1 ? [localName] : [],
    ),
  );
}

function importedLocalNameForCall(
  callNode: Parser.SyntaxNode,
  calleeNode: Parser.SyntaxNode,
  importedLocalNames: ReadonlySet<string>,
): string | undefined {
  const rootIdentifier = callRootIdentifier(calleeNode);
  if (
    rootIdentifier === undefined ||
    !importedLocalNames.has(rootIdentifier) ||
    hasEnclosingCallableBinding(callNode, rootIdentifier)
  ) {
    return undefined;
  }

  return rootIdentifier;
}

function callRootIdentifier(node: Parser.SyntaxNode): string | undefined {
  if (node.type === "identifier") {
    return node.text;
  }

  if (
    node.type !== "member_expression" &&
    node.type !== "subscript_expression"
  ) {
    return undefined;
  }

  const objectNode = node.childForFieldName("object");
  return objectNode === null ? undefined : callRootIdentifier(objectNode);
}

function hasEnclosingCallableBinding(
  callNode: Parser.SyntaxNode,
  name: string,
): boolean {
  let current = callNode.parent;

  while (current !== null) {
    if (isCallableNode(current) && callableDeclaresBinding(current, name)) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

function callableDeclaresBinding(
  callableNode: Parser.SyntaxNode,
  name: string,
): boolean {
  if (!METHOD_TYPES.has(callableNode.type)) {
    const callableName = callableNode.childForFieldName("name");
    if (callableName !== null && callableName.text === name) {
      return true;
    }
  }

  for (const fieldName of ["parameter", "parameters"] as const) {
    const parametersNode = callableNode.childForFieldName(fieldName);
    if (
      parametersNode !== null &&
      bindingPatternContainsName(parametersNode, name)
    ) {
      return true;
    }
  }

  const bodyNode = callableNode.childForFieldName("body");
  return bodyNode !== null && bodyDeclaresBinding(bodyNode, name);
}

function bodyDeclaresBinding(
  node: Parser.SyntaxNode,
  name: string,
): boolean {
  for (const child of node.namedChildren) {
    if (isCallableNode(child)) {
      if (
        FUNCTION_DECLARATION_TYPES.has(child.type) &&
        child.childForFieldName("name")?.text === name
      ) {
        return true;
      }

      continue;
    }

    if (CLASS_TYPES.has(child.type)) {
      if (child.childForFieldName("name")?.text === name) {
        return true;
      }

      continue;
    }

    if (child.type === "variable_declarator") {
      const bindingNode = child.childForFieldName("name");
      if (
        bindingNode !== null &&
        bindingPatternContainsName(bindingNode, name)
      ) {
        return true;
      }
    }

    if (child.type === "catch_clause") {
      const parameterNode = child.childForFieldName("parameter");
      if (
        parameterNode !== null &&
        bindingPatternContainsName(parameterNode, name)
      ) {
        return true;
      }
    }

    if (bodyDeclaresBinding(child, name)) {
      return true;
    }
  }

  return false;
}

function bindingPatternContainsName(
  node: Parser.SyntaxNode,
  name: string,
): boolean {
  if (
    (node.type === "identifier" ||
      node.type === "shorthand_property_identifier_pattern") &&
    node.text === name
  ) {
    return true;
  }

  return node.namedChildren.some((child) =>
    bindingPatternContainsName(child, name),
  );
}

function isCallableNode(node: Parser.SyntaxNode): boolean {
  return (
    FUNCTION_DECLARATION_TYPES.has(node.type) ||
    FUNCTION_EXPRESSION_TYPES.has(node.type) ||
    METHOD_TYPES.has(node.type)
  );
}

function extractDiagnostics(rootNode: Parser.SyntaxNode): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];

  walkAll(rootNode, (node) => {
    if (!node.isError && !node.isMissing) {
      return;
    }

    diagnostics.push({
      kind: node.isMissing ? "missing" : "error",
      nodeType: node.type,
      lineRange: toLineRange(node),
    });
  });

  return diagnostics;
}

function declarationBindings(
  declaration: Parser.SyntaxNode,
): Array<{ name: string; node: Parser.SyntaxNode }> {
  if (
    declaration.type === "lexical_declaration" ||
    declaration.type === "variable_declaration"
  ) {
    return declaration.namedChildren.flatMap((child) => {
      if (child.type !== "variable_declarator") {
        return [];
      }

      const nameNode = child.childForFieldName("name");
      return nameNode?.type === "identifier"
        ? [{ name: nameNode.text, node: child }]
        : [];
    });
  }

  const nameNode = declaration.childForFieldName("name");
  return nameNode === null
    ? []
    : [{ name: nodeName(nameNode), node: declaration }];
}

function exportedValueName(valueNode: Parser.SyntaxNode): string | undefined {
  if (valueNode.type === "identifier") {
    return valueNode.text;
  }

  const nameNode = valueNode.childForFieldName("name");
  return nameNode === null ? undefined : nodeName(nameNode);
}

function symbolTypeForNode(
  node: Parser.SyntaxNode,
): "function" | "class" | undefined {
  if (
    FUNCTION_DECLARATION_TYPES.has(node.type) ||
    FUNCTION_EXPRESSION_TYPES.has(node.type) ||
    METHOD_TYPES.has(node.type)
  ) {
    return "function";
  }

  return CLASS_TYPES.has(node.type) ? "class" : undefined;
}

function isTopLevelVariable(node: Parser.SyntaxNode): boolean {
  const declaration = node.parent;
  const declarationParent = declaration?.parent;
  return (
    node.type === "variable_declarator" &&
    (declaration?.type === "lexical_declaration" ||
      declaration?.type === "variable_declaration") &&
    (declarationParent?.type === "program" ||
      declarationParent?.type === "export_statement")
  );
}

function isDirectVariableExport(node: Parser.SyntaxNode): boolean {
  return node.parent?.parent?.type === "export_statement";
}

function symbolNameForNode(node: Parser.SyntaxNode): string | undefined {
  if (METHOD_TYPES.has(node.type)) {
    const methodNameNode = node.childForFieldName("name");
    if (methodNameNode === null) {
      return undefined;
    }

    const methodName = nodeName(methodNameNode);
    const className = enclosingClassName(node);
    return className === undefined ? undefined : `${className}.${methodName}`;
  }

  if (
    FUNCTION_DECLARATION_TYPES.has(node.type) ||
    node.type === "class_declaration" ||
    node.type === "abstract_class_declaration"
  ) {
    const nameNode = node.childForFieldName("name");
    return nameNode === null ? defaultExportName(node) : nodeName(nameNode);
  }

  const assignedName = assignedFunctionOrClassName(node);
  if (assignedName !== undefined) {
    return assignedName;
  }

  const ownName = node.childForFieldName("name");
  if (ownName !== null) {
    return nodeName(ownName);
  }

  return defaultExportName(node);
}

function assignedFunctionOrClassName(
  node: Parser.SyntaxNode,
): string | undefined {
  const parent = node.parent;
  if (parent === null) {
    return undefined;
  }

  if (parent.type === "assignment_expression") {
    return parent.childForFieldName("right")?.id === node.id
      ? commonJsExportTarget(parent)?.exportedName
      : undefined;
  }

  if (parent.childForFieldName("value")?.id !== node.id) {
    return undefined;
  }

  if (parent.type === "variable_declarator") {
    const nameNode = parent.childForFieldName("name");
    return nameNode?.type === "identifier" ? nameNode.text : undefined;
  }

  if (
    parent.type === "public_field_definition" ||
    parent.type === "field_definition"
  ) {
    const fieldNameNode =
      parent.childForFieldName("name") ??
      parent.childForFieldName("property");
    if (fieldNameNode === null) {
      return undefined;
    }

    const className = enclosingClassName(parent);
    return className === undefined
      ? undefined
      : `${className}.${nodeName(fieldNameNode)}`;
  }

  return undefined;
}

function enclosingClassName(node: Parser.SyntaxNode): string | undefined {
  let current = node.parent;

  while (current !== null) {
    if (CLASS_TYPES.has(current.type)) {
      const assignedName = assignedFunctionOrClassName(current);
      const nameNode = current.childForFieldName("name");
      return assignedName ??
        (nameNode === null ? defaultExportName(current) : nodeName(nameNode));
    }

    current = current.parent;
  }

  return undefined;
}

function defaultExportName(node: Parser.SyntaxNode): string | undefined {
  return node.parent?.type === "export_statement" &&
    hasDirectChild(node.parent, "default")
    ? "default"
    : undefined;
}

function isDirectModuleExport(node: Parser.SyntaxNode): boolean {
  if (node.parent?.type === "export_statement") {
    return true;
  }

  if (
    node.parent?.type === "assignment_expression" &&
    commonJsExportTarget(node.parent) !== undefined
  ) {
    return true;
  }

  const variableDeclaration = node.parent;
  const declaration = variableDeclaration?.parent;
  return (
    variableDeclaration?.type === "variable_declarator" &&
    declaration !== null &&
    (declaration?.type === "lexical_declaration" ||
      declaration?.type === "variable_declaration") &&
    declaration.parent?.type === "export_statement"
  );
}

function isTopLevelSymbol(node: Parser.SyntaxNode): boolean {
  if (
    FUNCTION_DECLARATION_TYPES.has(node.type) ||
    node.type === "class_declaration" ||
    node.type === "abstract_class_declaration"
  ) {
    return (
      node.parent?.type === "program" ||
      node.parent?.type === "export_statement"
    );
  }

  const variableDeclaration = node.parent;
  const declaration = variableDeclaration?.parent;
  const declarationParent = declaration?.parent;
  return (
    variableDeclaration?.type === "variable_declarator" &&
    (declaration?.type === "lexical_declaration" ||
      declaration?.type === "variable_declaration") &&
    (declarationParent?.type === "program" ||
      declarationParent?.type === "export_statement")
  );
}

function enclosingCallableName(node: Parser.SyntaxNode): string | undefined {
  let current = node.parent;

  while (current !== null) {
    if (
      FUNCTION_DECLARATION_TYPES.has(current.type) ||
      FUNCTION_EXPRESSION_TYPES.has(current.type) ||
      METHOD_TYPES.has(current.type)
    ) {
      const name = symbolNameForNode(current);
      if (name !== undefined) {
        return name;
      }
    }

    current = current.parent;
  }

  return undefined;
}

function callKindForNode(node: Parser.SyntaxNode): ParsedCallKind {
  if (node.type === "identifier") {
    return "identifier";
  }

  if (
    node.type === "member_expression" ||
    node.type === "subscript_expression"
  ) {
    return "member";
  }

  return "other";
}

function firstStringArgument(
  callNode: Parser.SyntaxNode,
): Parser.SyntaxNode | undefined {
  const argumentsNode = callNode.childForFieldName("arguments");
  return argumentsNode?.namedChildren.find((child) => child.type === "string");
}

function requireBindings(callNode: Parser.SyntaxNode): Array<{
  importedName: string;
  localName: string;
  node: Parser.SyntaxNode;
}> {
  const declarator = callNode.parent;
  if (
    declarator?.type !== "variable_declarator" ||
    declarator.childForFieldName("value")?.id !== callNode.id
  ) {
    return [];
  }

  const nameNode = declarator.childForFieldName("name");
  if (nameNode === null) {
    return [];
  }

  if (nameNode.type === "identifier") {
    return [
      {
        importedName: "*",
        localName: nameNode.text,
        node: nameNode,
      },
    ];
  }

  if (nameNode.type !== "object_pattern") {
    return [];
  }

  return nameNode.namedChildren.flatMap((bindingNode) => {
    if (bindingNode.type === "shorthand_property_identifier_pattern") {
      return [
        {
          importedName: bindingNode.text,
          localName: bindingNode.text,
          node: bindingNode,
        },
      ];
    }

    if (bindingNode.type !== "pair_pattern") {
      return [];
    }

    const importedNameNode = bindingNode.childForFieldName("key");
    const localNameNode = bindingNode.childForFieldName("value");
    if (importedNameNode === null || localNameNode?.type !== "identifier") {
      return [];
    }

    return [
      {
        importedName: nodeName(importedNameNode),
        localName: localNameNode.text,
        node: bindingNode,
      },
    ];
  });
}

function commonJsExportTarget(
  assignment: Parser.SyntaxNode,
): { kind: "default" | "named"; exportedName: string } | undefined {
  const leftNode = assignment.childForFieldName("left");
  if (leftNode === null) {
    return undefined;
  }

  const memberPath = staticMemberPath(leftNode);
  if (memberPath === undefined) {
    return undefined;
  }

  if (memberPath.length === 2 && memberPath.join(".") === "module.exports") {
    return { kind: "default", exportedName: "default" };
  }

  if (memberPath.length === 2 && memberPath[0] === "exports") {
    return { kind: "named", exportedName: memberPath[1] ?? "" };
  }

  if (
    memberPath.length === 3 &&
    memberPath[0] === "module" &&
    memberPath[1] === "exports"
  ) {
    return { kind: "named", exportedName: memberPath[2] ?? "" };
  }

  return undefined;
}

function staticMemberPath(node: Parser.SyntaxNode): string[] | undefined {
  if (node.type === "identifier") {
    return [node.text];
  }
  if (node.type === "this") {
    return ["this"];
  }

  if (node.type !== "member_expression") {
    return undefined;
  }

  const objectNode = node.childForFieldName("object");
  const propertyNode = node.childForFieldName("property");
  if (
    objectNode === null ||
    propertyNode === null ||
    propertyNode.type !== "property_identifier"
  ) {
    return undefined;
  }

  const objectPath = staticMemberPath(objectNode);
  return objectPath === undefined
    ? undefined
    : [...objectPath, propertyNode.text];
}

function compareByLineRange(
  left: { lineRange: LineRange },
  right: { lineRange: LineRange },
): number {
  return (
    left.lineRange.start - right.lineRange.start ||
    left.lineRange.end - right.lineRange.end
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createImport(input: {
  kind: ParsedImportKind;
  source: string;
  importedName?: string;
  localName?: string;
  typeOnly: boolean;
  lineRange: LineRange;
}): ParsedImport {
  const result: ParsedImport = {
    kind: input.kind,
    source: input.source,
    typeOnly: input.typeOnly,
    lineRange: input.lineRange,
  };

  if (input.importedName !== undefined) {
    result.importedName = input.importedName;
  }

  if (input.localName !== undefined) {
    result.localName = input.localName;
  }

  return result;
}

function createExport(input: {
  kind: ParsedExportKind;
  exportedName: string;
  localName?: string;
  source?: string;
  typeOnly: boolean;
  lineRange: LineRange;
}): ParsedExport {
  const result: ParsedExport = {
    kind: input.kind,
    exportedName: input.exportedName,
    typeOnly: input.typeOnly,
    lineRange: input.lineRange,
  };

  if (input.localName !== undefined) {
    result.localName = input.localName;
  }

  if (input.source !== undefined) {
    result.source = input.source;
  }

  return result;
}

function nodeName(node: Parser.SyntaxNode): string {
  return node.type === "string" ? stringNodeValue(node) : node.text;
}

function stringNodeValue(node: Parser.SyntaxNode): string {
  const text = node.text;
  return text.length >= 2 ? text.slice(1, -1) : text;
}

function hasDirectChild(node: Parser.SyntaxNode, type: string): boolean {
  return node.children.some((child) => child.type === type);
}

function toLineRange(node: Parser.SyntaxNode): LineRange {
  return {
    start: node.startPosition.row + 1,
    end: node.endPosition.row + 1,
  };
}

function walkNamed(
  node: Parser.SyntaxNode,
  visit: (node: Parser.SyntaxNode) => void,
): void {
  visit(node);

  for (const child of node.namedChildren) {
    walkNamed(child, visit);
  }
}

function walkAll(
  node: Parser.SyntaxNode,
  visit: (node: Parser.SyntaxNode) => void,
): void {
  visit(node);

  for (const child of node.children) {
    walkAll(child, visit);
  }
}
