import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";

import { isSupportedSourceFile } from "../languages/languageFrontends.ts";
import type { ParsedSourceFile } from "../parser/types.js";
import type { ScannedFile } from "../scanner/types.js";
import { FRAMEWORK_PACKS } from "./catalog.ts";
import {
  DEFAULT_FRAMEWORK_REGISTRY,
  type FrameworkRegistry,
} from "./registry.ts";
import { detectRepositoryFrameworks } from "./detectFrameworks.ts";
import type { RepositorySupportReport } from "./types.js";

const DEPENDENCY_MANIFEST_NAMES = new Set([
  "package.json", "pipfile", "pyproject.toml", "requirements.txt",
]);

export async function buildRepositorySupportReport(
  repositoryRoot: string,
  scannedFiles: readonly ScannedFile[],
  parsedFiles: readonly ParsedSourceFile[],
  registry: FrameworkRegistry = DEFAULT_FRAMEWORK_REGISTRY,
): Promise<RepositorySupportReport> {
  const packageNames = await readDeclaredPackageNames(
    repositoryRoot,
    scannedFiles,
    registry.packs(),
  );
  const successfullyParsedFiles = parsedFiles.filter(
    (file) => file.diagnostics.length === 0,
  );
  const parsedPaths = new Set(successfullyParsedFiles.map((file) => file.path));
  const languages: Record<string, number> = {};
  for (const file of scannedFiles) {
    languages[file.language] = (languages[file.language] ?? 0) + 1;
  }
  const diagnostics = parsedFiles.flatMap((file) => [
    ...file.diagnostics.map((diagnostic) => ({
      kind: diagnostic.kind === "missing" ? "parse-missing" as const : "parse-error" as const,
      message: `Unable to index ${diagnostic.nodeType} syntax at lines ${diagnostic.lineRange.start}-${diagnostic.lineRange.end}.`,
      file: file.path,
      line: diagnostic.lineRange.start,
    })),
    ...(file.frameworkDiagnostics ?? []).map((diagnostic) => ({
      kind: diagnostic.kind,
      message: diagnostic.message,
      file: file.path,
      line: diagnostic.lineRange.start,
    })),
  ]
  ).sort((left, right) =>
    compareStrings(left.file, right.file) || left.line - right.line
  );

  return {
    languages: Object.fromEntries(
      Object.entries(languages).sort(([left], [right]) => compareStrings(left, right)),
    ),
    parsedFiles: successfullyParsedFiles.length,
    unparsedSourceFiles: scannedFiles
      .filter((file) => isSupportedSourceFile(file) && !parsedPaths.has(file.path))
      .map((file) => file.path)
      .sort(compareStrings),
    frameworks: detectRepositoryFrameworks({
      parsedFiles: successfullyParsedFiles,
      scannedPaths: scannedFiles.map((file) => file.path),
      packageNames,
    }, registry.packs()),
    diagnostics,
    supportDefinition: {
      baseline: "Language-level files, symbols, imports, calls, and evidence are extracted.",
      entrypoints: "Baseline support plus framework entrypoint and lifecycle conventions.",
      semantic: "Entrypoint support plus framework-specific semantic relationships.",
    },
  };
}

async function readDeclaredPackageNames(
  repositoryRoot: string,
  scannedFiles: readonly ScannedFile[],
  packs = FRAMEWORK_PACKS,
): Promise<Set<string>> {
  const packages = new Set<string>();
  const knownPackages = new Set(
    packs.flatMap((pack) => pack.detection.packageNames ?? [])
      .map(normalizePackageName),
  );
  for (const file of scannedFiles) {
    const name = basename(file.path).toLowerCase();
    if (!isDependencyManifest(name)) continue;
    let content: string;
    try {
      content = await readFile(join(repositoryRoot, ...file.path.split("/")), "utf8");
    } catch {
      continue;
    }
    if (name === "package.json") {
      addNodePackageDependencies(content, packages);
      continue;
    }
    for (const packageName of knownPackages) {
      if (manifestMentionsPackage(content, packageName)) packages.add(packageName);
    }
  }
  return packages;
}

function isDependencyManifest(name: string): boolean {
  return DEPENDENCY_MANIFEST_NAMES.has(name) ||
    (name.startsWith("requirements") && name.endsWith(".txt"));
}

function addNodePackageDependencies(content: string, packages: Set<string>): void {
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch {
    return;
  }
  if (!isRecord(manifest)) return;
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const dependencies = manifest[field];
    if (!isRecord(dependencies)) continue;
    for (const packageName of Object.keys(dependencies)) {
      packages.add(normalizePackageName(packageName));
    }
  }
}

function manifestMentionsPackage(content: string, packageName: string): boolean {
  const normalized = content.toLowerCase().replaceAll("_", "-");
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^a-z0-9-])${escaped}(?=$|[^a-z0-9-])`, "mu").test(normalized);
}

function normalizePackageName(value: string): string {
  return value.toLowerCase().replaceAll("_", "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
