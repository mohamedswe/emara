import { parsePythonSourceFile } from "./python/parsePythonSourceFile.ts";
import type { ParsedSourceFile } from "../parser/types.js";
import type { FrameworkRegistry } from "../frameworks/registry.js";

export function parsePythonNotebook(
  filePath: string,
  source: string,
  registry: FrameworkRegistry,
): ParsedSourceFile {
  const extraction = extractLinePreservingCodeCells(source);
  const parsed = parsePythonSourceFile(filePath, extraction.source, registry);
  const frameworkDiagnostics = [
    ...(parsed.frameworkDiagnostics ?? []),
    ...extraction.diagnostics,
  ];
  return {
    ...parsed,
    detectedFrameworks: ["python-data-ui"],
    ...(frameworkDiagnostics.length === 0 ? {} : { frameworkDiagnostics }),
  };
}

function extractLinePreservingCodeCells(source: string): {
  source: string;
  diagnostics: NonNullable<ParsedSourceFile["frameworkDiagnostics"]>;
} {
  const lines = source.split(/\r?\n/u);
  const extracted = lines.map(() => "");
  const diagnostics: NonNullable<ParsedSourceFile["frameworkDiagnostics"]> = [];
  let codeCell = false;
  let sourceArray = false;
  let sawCodeCell = false;
  let mappedCodeLine = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/"cell_type"\s*:\s*"code"/u.test(line)) {
      codeCell = true;
      sawCodeCell = true;
    }
    if (/"cell_type"\s*:\s*"(?:markdown|raw)"/u.test(line)) codeCell = false;
    if (codeCell && /"source"\s*:\s*\[/u.test(line)) {
      sourceArray = true;
      continue;
    }
    if (!sourceArray) continue;
    if (/^\s*\]/u.test(line)) {
      sourceArray = false;
      continue;
    }
    const encoded = /^\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/u.exec(line)?.[1];
    if (encoded === undefined) continue;
    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded);
    } catch {
      continue;
    }
    if (typeof decoded !== "string") continue;
    const codeLines = decoded.replace(/\r?\n$/u, "").split(/\r?\n/u);
    const mappedLine = codeLines[0] ?? "";
    extracted[index] = mappedLine;
    mappedCodeLine ||= mappedLine.trim().length > 0;
    if (codeLines.length > 1) {
      diagnostics.push({
        kind: "unresolved-registration",
        message: "A notebook source JSON string contains multiple code lines; only its first line has an exact source-file line mapping.",
        lineRange: { start: index + 1, end: index + 1 },
      });
    }
  }

  if (sawCodeCell && !mappedCodeLine) {
    diagnostics.push({
      kind: "unresolved-registration",
      message: "Notebook code cells could not be mapped to exact JSON lines. Save the notebook as pretty-printed JSON to enable line-level analysis.",
      lineRange: { start: 1, end: 1 },
    });
  }

  return { source: extracted.join("\n"), diagnostics };
}
