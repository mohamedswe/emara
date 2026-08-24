import { FRAMEWORK_PACKS } from "./catalog.ts";
import type {
  DetectedFramework,
  FrameworkDetectionInput,
  FrameworkPack,
} from "./types.js";
import type { ParsedSourceFile } from "../parser/types.js";

export function detectFrameworksForFile(
  parsedFile: ParsedSourceFile,
  path = parsedFile.path,
  packs: readonly FrameworkPack[] = FRAMEWORK_PACKS,
): DetectedFramework[] {
  const importSources = parsedFile.imports.map((item) => item.source);
  return packs.flatMap((pack) => {
    if (!pack.languages.includes(parsedFile.language)) return [];
    const evidence = detectionEvidence(pack, importSources, [path], new Set());
    return evidence.length === 0 ? [] : [detected(pack, evidence)];
  });
}

export function detectRepositoryFrameworks(
  input: FrameworkDetectionInput,
  packs: readonly FrameworkPack[] = FRAMEWORK_PACKS,
): DetectedFramework[] {
  const importSources = input.parsedFiles.flatMap((file) =>
    file.imports.map((item) => item.source)
  );
  const detectedFrameworks = packs.flatMap((pack) => {
    const evidence = detectionEvidence(
      pack,
      importSources,
      input.scannedPaths,
      input.packageNames ?? new Set(),
    );
    return evidence.length === 0 ? [] : [detected(pack, evidence)];
  });
  return detectedFrameworks.sort((left, right) => compareStrings(left.id, right.id));
}

function detectionEvidence(
  pack: FrameworkPack,
  importSources: readonly string[],
  scannedPaths: readonly string[],
  packageNames: ReadonlySet<string>,
): string[] {
  const evidence = new Set<string>();
  for (const packageName of pack.detection.packageNames ?? []) {
    if (packageNames.has(packageName)) evidence.add(`package:${packageName}`);
  }
  for (const prefix of pack.detection.importPrefixes ?? []) {
    const source = importSources.find((item) =>
      item === prefix || item.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)
    );
    if (source !== undefined) evidence.add(`import:${source}`);
  }
  for (const pattern of pack.detection.pathPatterns ?? []) {
    const path = scannedPaths.find((item) => pattern.test(item));
    if (path !== undefined) evidence.add(`path:${path}`);
  }
  return [...evidence].sort(compareStrings);
}

function detected(pack: FrameworkPack, evidence: readonly string[]): DetectedFramework {
  return {
    id: pack.id,
    displayName: pack.displayName,
    family: pack.family,
    support: pack.support,
    evidence,
  };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
