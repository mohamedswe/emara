import type { RepositoryGraph } from "../graph/types.js";
import type { IndexedSourceFile } from "../graph/indexedSourceFile.ts";
import {
  isSupportedSourceFile,
  parseWithLanguageFrontend,
} from "../languages/languageFrontends.ts";
import type { ParsedImport } from "../parser/types.js";
import { getSource } from "../retrieval/getSource.ts";
import { isTestFilePath } from "../scanner/classifyFilePath.ts";
import type { ScannedFile } from "../scanner/types.js";
import type { DeadCodeCandidate } from "../audit/types.js";

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

/**
 * Finds import bindings that have no lexical use outside their import statement.
 *
 * This is intentionally conservative. Comments and strings may keep an actually
 * unused import out of the result, while ambiguous same-line statements and
 * duplicate bindings are skipped. Returned candidates still require isolated
 * removal validation before they can be called safe to delete.
 */
export async function findUnusedImportCandidates(
  graph: RepositoryGraph,
  repositoryPath: string,
  indexedSourceFiles: readonly IndexedSourceFile[] = [],
): Promise<DeadCodeCandidate[]> {
  const results: DeadCodeCandidate[] = [];
  const indexedSourcesByPath = new Map(
    indexedSourceFiles.map((source) => [source.file.path, source]),
  );

  for (const file of graph.files) {
    if (
      file.lineRange === undefined ||
      isTestFilePath(file.path) ||
      !isSupportedSourceFile(file as ScannedFile)
    ) {
      continue;
    }
    const indexedSource = indexedSourcesByPath.get(file.path);
    const reusableSource = indexedSource?.file.contentHash === file.contentHash &&
        indexedSource.file.language === file.language &&
        Buffer.byteLength(indexedSource.content, "utf8") <= MAX_SOURCE_BYTES
      ? indexedSource
      : undefined;
    const slice = reusableSource === undefined
      ? await getSource(graph, repositoryPath, file.id, {
          maxLines: file.lineRange.end,
          maxBytes: MAX_SOURCE_BYTES,
        })
      : undefined;
    const content = reusableSource?.content ?? slice?.content ?? "";
    const parsed = reusableSource?.parsed ??
      parseWithLanguageFrontend(file as ScannedFile, content);
    if (parsed.diagnostics.length > 0) continue;

    const importsByBinding = groupImportsByBinding(parsed.imports);
    for (const [binding, imports] of importsByBinding) {
      if (imports.length !== 1) continue;
      const imported = imports[0];
      if (imported === undefined || hasLexicalUse(content, binding, imported)) {
        continue;
      }
      results.push({
        id: `dead-import:${file.path}:${binding}`,
        nodeIds: [],
        file: file.path,
        line: imported.lineRange.start,
        symbol: binding,
        reachabilityStatus: "disconnected_candidate",
        verdict: "VALIDATION_REQUIRED",
        reason:
          `Import binding ${JSON.stringify(binding)} has no lexical use outside its import statement.`,
        blockers: [
          "Remove only this import binding in an isolated workspace, then run the repository's typecheck, build, and tests.",
        ],
        validation: null,
      });
    }
  }

  return results.sort(
    (left, right) =>
      compareText(left.file, right.file) ||
      compareText(left.symbol, right.symbol),
  );
}

function groupImportsByBinding(
  imports: readonly ParsedImport[],
): Map<string, ParsedImport[]> {
  const grouped = new Map<string, ParsedImport[]>();
  for (const imported of imports) {
    const binding = imported.localName;
    if (
      binding === undefined ||
      binding === "*" ||
      imported.kind === "side-effect" ||
      imported.kind === "dynamic" ||
      imported.typeOnly
    ) {
      continue;
    }
    const values = grouped.get(binding) ?? [];
    values.push(imported);
    grouped.set(binding, values);
  }
  return grouped;
}

function hasLexicalUse(
  source: string,
  binding: string,
  imported: ParsedImport,
): boolean {
  const expression = new RegExp(`\\b${escapeRegExp(binding)}\\b`, "gu");
  const lines = source.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (!expression.test(line)) {
      expression.lastIndex = 0;
      continue;
    }
    expression.lastIndex = 0;
    const lineNumber = index + 1;
    if (
      lineNumber < imported.lineRange.start ||
      lineNumber > imported.lineRange.end
    ) {
      return true;
    }
    // A semicolon can put a real use on the same physical line as an import.
    // Treat that shape as ambiguous instead of recommending removal.
    if (line.includes(";")) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
