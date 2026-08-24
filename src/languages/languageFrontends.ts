import { detectFrameworksForFile } from "../frameworks/detectFrameworks.ts";
import {
  DEFAULT_FRAMEWORK_REGISTRY,
  type FrameworkRegistry,
} from "../frameworks/registry.ts";
import { parseSourceFile } from "../parser/parseSourceFile.ts";
import type { ParsedSourceFile } from "../parser/types.js";
import type { ScannedFile } from "../scanner/types.js";
import { parseEmbeddedScriptFile } from "./embeddedScriptFrontend.ts";
import { parsePythonNotebook } from "./notebookFrontend.ts";
import { parsePythonSourceFile } from "./python/parsePythonSourceFile.ts";
import type { LanguageFrontend } from "./types.js";

const FRONTENDS: readonly LanguageFrontend[] = [
  {
    id: "javascript-typescript",
    supports: (file) => file.language === "javascript" || file.language === "typescript",
    parse: (file, source, registry) => parseSourceFile(file.path, source, registry),
  },
  {
    id: "python",
    supports: (file) => file.language === "python",
    parse: (file, source, registry) => parsePythonSourceFile(file.path, source, registry),
  },
  {
    id: "embedded-javascript",
    supports: (file) => ["astro", "svelte", "vue"].includes(file.language),
    parse: (file, source, registry) => parseEmbeddedScriptFile(file.path, source, registry),
  },
  {
    id: "jupyter-python",
    supports: (file) => file.language === "jupyter",
    parse: (file, source, registry) => parsePythonNotebook(file.path, source, registry),
  },
];

export function sourceFrontendForFile(
  file: ScannedFile,
): LanguageFrontend | undefined {
  return FRONTENDS.find((frontend) => frontend.supports(file));
}

export function isSupportedSourceFile(file: ScannedFile): boolean {
  return sourceFrontendForFile(file) !== undefined;
}

export function parseWithLanguageFrontend(
  file: ScannedFile,
  source: string,
  registry: FrameworkRegistry = DEFAULT_FRAMEWORK_REGISTRY,
): ParsedSourceFile {
  const frontend = sourceFrontendForFile(file);
  if (frontend === undefined) {
    throw new Error(`No language frontend for ${file.path} (${file.language})`);
  }
  const parsed = frontend.parse(file, source, registry);
  const detectedFrameworks = new Set(parsed.detectedFrameworks ?? []);
  for (const framework of detectFrameworksForFile(
    parsed,
    file.path,
    registry.packs(),
  )) {
    detectedFrameworks.add(framework.id);
  }
  return detectedFrameworks.size === 0
    ? parsed
    : { ...parsed, detectedFrameworks: [...detectedFrameworks].sort() };
}
