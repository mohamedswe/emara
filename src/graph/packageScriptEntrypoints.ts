import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";

import type {
  ParsedEntryPoint,
  ParsedSourceFile,
} from "../parser/types.js";
import type { ScannedFile } from "../scanner/types.js";

export async function addPackageScriptEntrypoints(
  repositoryRoot: string,
  scannedFiles: readonly ScannedFile[],
  parsedFiles: readonly ParsedSourceFile[],
): Promise<ParsedSourceFile[]> {
  const parsedPaths = new Set(parsedFiles.map((file) => file.path));
  const entrypointsByPath = new Map<string, ParsedEntryPoint[]>();
  const manifests = scannedFiles
    .filter((file) => posix.basename(file.path).toLowerCase() === "package.json")
    .sort((left, right) => compareText(left.path, right.path));

  for (const manifestFile of manifests) {
    const absolutePath = join(
      repositoryRoot,
      ...manifestFile.path.split("/"),
    );
    let manifest: unknown;
    try {
      manifest = JSON.parse(await readFile(absolutePath, "utf8"));
    } catch {
      continue;
    }
    if (!isRecord(manifest) || !isRecord(manifest.scripts)) continue;

    for (const [scriptName, command] of Object.entries(manifest.scripts).sort(
      ([left], [right]) => compareText(left, right),
    )) {
      if (typeof command !== "string") continue;
      for (const target of nodeScriptTargets(command)) {
        const targetPath = resolveScriptTarget(manifestFile.path, target);
        if (targetPath === undefined || !parsedPaths.has(targetPath)) continue;
        const values = entrypointsByPath.get(targetPath) ?? [];
        const qualifiedName = posix.dirname(manifestFile.path) === "."
          ? scriptName
          : `${posix.dirname(manifestFile.path)}:${scriptName}`;
        values.push({
          kind: "cli",
          name: `npm script ${qualifiedName}`,
          exposure: "external",
          lineRange: { start: 1, end: 1 },
        });
        entrypointsByPath.set(targetPath, values);
      }
    }
  }

  return parsedFiles.map((file) => {
    const additional = deduplicateEntrypoints(entrypointsByPath.get(file.path) ?? []);
    return additional.length === 0
      ? file
      : { ...file, entrypoints: [...file.entrypoints, ...additional] };
  });
}

function nodeScriptTargets(command: string): string[] {
  const targets: string[] = [];
  for (const segment of shellSegments(command)) {
    const tokens = shellTokens(segment);
    let index = 0;
    if (tokens[index] === "cross-env" || tokens[index] === "cross-env-shell") {
      index += 1;
    }
    while (tokens[index] !== undefined && ENVIRONMENT_ASSIGNMENT.test(tokens[index] as string)) {
      index += 1;
    }
    if (!/^(?:node|node\.exe)$/iu.test(tokens[index] ?? "")) continue;
    const target = tokens[index + 1];
    if (
      target === undefined ||
      target.startsWith("-") ||
      /[*?$<>]/u.test(target)
    ) {
      continue;
    }
    targets.push(target);
  }
  return [...new Set(targets)].sort(compareText);
}

function shellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (const character of command) {
    if (character === "'" || character === '"') {
      quote = quote === undefined ? character : quote === character ? undefined : quote;
      current += character;
      continue;
    }
    if (quote === undefined && (character === ";" || character === "&" || character === "|")) {
      if (current.trim().length > 0) segments.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim().length > 0) segments.push(current.trim());
  return segments;
}

function shellTokens(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (const character of segment) {
    if (character === "'" || character === '"') {
      quote = quote === undefined ? character : quote === character ? undefined : quote;
      continue;
    }
    if (quote === undefined && /\s/u.test(character)) {
      if (current.length > 0) tokens.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function resolveScriptTarget(
  manifestPath: string,
  target: string,
): string | undefined {
  const normalizedTarget = target.replaceAll("\\", "/");
  if (posix.isAbsolute(normalizedTarget)) return undefined;
  const resolved = posix.normalize(
    posix.join(posix.dirname(manifestPath), normalizedTarget),
  );
  return resolved === ".." || resolved.startsWith("../") ? undefined : resolved;
}

function deduplicateEntrypoints(
  entrypoints: readonly ParsedEntryPoint[],
): ParsedEntryPoint[] {
  const byName = new Map<string, ParsedEntryPoint>();
  for (const entrypoint of entrypoints) byName.set(entrypoint.name, entrypoint);
  return [...byName.values()].sort((left, right) => compareText(left.name, right.name));
}

const ENVIRONMENT_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=\S+$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
