import { posix } from "node:path";

import type { LineRange, ParsedSourceFile } from "../parser/types.js";
import {
  type InternalModuleResolutionOptions,
  resolveInternalModulePath,
} from "./resolveInternalImports.ts";
import type { PartialImportEvidence } from "./types.js";
import { compareText } from "../shared/compare.ts";

const MAX_MENTION_LENGTH = 300;
const STRING_LITERAL_PATTERN = /(["'`])((?:(?!\1)[^\\\r\n]|\\.){1,300})\1/gu;
const PYTHON_IMPORT_PATTERN = /^\s*(?:from\s+(\.*[A-Za-z_][\w.]*|\.+)\s+import\b|import\s+([A-Za-z_][\w.]*))/u;

export interface PartiallyParsedSource {
  parsed: ParsedSourceFile;
  content: string;
}

/**
 * Files with parser diagnostics are excluded from the graph, so anything they
 * import looks unused. This recovers conservative evidence that such a file
 * may consume other repository files:
 *
 * - `recovered-import`: an import the error-tolerant tree still produced
 *   outside every diagnostic range, resolved like a normal internal import.
 * - `string-mention`: a string literal (or Python import line) anywhere in the
 *   file whose module path resolves to, or whose last segment matches the
 *   basename stem of, a repository source file.
 *
 * The evidence is never turned into graph edges; it can only make liveness
 * less certain.
 */
export function recoverPartialImports(
  sources: readonly PartiallyParsedSource[],
  sourceFilePaths: readonly string[],
  options: InternalModuleResolutionOptions = {},
): PartialImportEvidence[] {
  const filePaths = new Set(sourceFilePaths);
  const pathsByStem = new Map<string, string[]>();
  for (const path of sourceFilePaths) {
    const stem = moduleStem(path);
    if (stem.length === 0) continue;
    const values = pathsByStem.get(stem) ?? [];
    values.push(path);
    pathsByStem.set(stem, values);
  }

  const evidence = new Map<string, PartialImportEvidence>();
  const add = (value: PartialImportEvidence): void => {
    if (value.target === value.file) return;
    const key = `${value.file}\0${value.target}\0${value.kind}`;
    const existing = evidence.get(key);
    if (existing === undefined || value.line < existing.line) evidence.set(key, value);
  };

  for (const { parsed, content } of sources) {
    if (parsed.diagnostics.length === 0) continue;
    for (const item of parsed.imports) {
      if (parsed.diagnostics.some((diagnostic) => overlaps(diagnostic.lineRange, item.lineRange))) {
        continue;
      }
      const target = resolveInternalModulePath(parsed.path, item.source, filePaths, options);
      if (target !== undefined) {
        add({ file: parsed.path, line: item.lineRange.start, target, kind: "recovered-import" });
      }
    }

    for (const [index, line] of content.split(/\r?\n/u).entries()) {
      for (const mention of lineMentions(line)) {
        const resolved = resolveInternalModulePath(parsed.path, mention, filePaths, options);
        const targets = new Set<string>(resolved === undefined ? [] : [resolved]);
        for (const path of pathsByStem.get(moduleStem(mention)) ?? []) targets.add(path);
        for (const target of targets) {
          add({ file: parsed.path, line: index + 1, target, kind: "string-mention" });
        }
      }
    }
  }

  return [...evidence.values()].sort(comparePartialImportEvidence);
}

export function comparePartialImportEvidence(
  left: PartialImportEvidence,
  right: PartialImportEvidence,
): number {
  return compareText(left.file, right.file) ||
    compareText(left.target, right.target) ||
    compareText(left.kind, right.kind) ||
    left.line - right.line;
}

function lineMentions(line: string): string[] {
  const mentions: string[] = [];
  for (const match of line.matchAll(STRING_LITERAL_PATTERN)) {
    const value = match[2];
    if (value !== undefined && value.length <= MAX_MENTION_LENGTH && !/\s/u.test(value)) {
      mentions.push(value);
    }
  }
  const python = line.match(PYTHON_IMPORT_PATTERN);
  const module = python?.[1] ?? python?.[2];
  if (module !== undefined) {
    mentions.push(module.replace(/^\.+/u, "").replaceAll(".", "/"));
  }
  return mentions;
}

/** Last path segment without extension (`./lib/b.js` -> `b`, `pkg/__init__.py` -> `pkg`). */
function moduleStem(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "");
  let base = posix.basename(normalized);
  const dot = base.indexOf(".");
  if (dot > 0) base = base.slice(0, dot);
  if (base === "index" || base === "__init__") {
    const parent = posix.basename(posix.dirname(normalized));
    return parent === "." ? base : parent;
  }
  return base;
}

function overlaps(left: LineRange, right: LineRange): boolean {
  return left.start <= right.end && right.start <= left.end;
}
