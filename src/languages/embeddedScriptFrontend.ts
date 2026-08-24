import { parseJavaScriptSourceFile } from "../parser/parseSourceFile.ts";
import type { ParsedSourceFile } from "../parser/types.js";
import type { FrameworkRegistry } from "../frameworks/registry.js";

export function parseEmbeddedScriptFile(
  filePath: string,
  source: string,
  registry: FrameworkRegistry,
): ParsedSourceFile {
  const extracted = linePreservingScriptSource(filePath, source);
  const language = /<script\b[^>]*\blang\s*=\s*["']ts["']/iu.test(source)
    ? "typescript" as const
    : "javascript" as const;
  const parsed = parseJavaScriptSourceFile(filePath, extracted, language, registry);
  return {
    ...parsed,
    detectedFrameworks: [frameworkForExtension(filePath)],
  };
}

function linePreservingScriptSource(filePath: string, source: string): string {
  const output = [...source].map((character) =>
    character === "\n" || character === "\r" ? character : " "
  );
  let copied = false;
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu;
  for (const match of source.matchAll(scriptPattern)) {
    const body = match[1];
    const matchStart = match.index;
    if (body === undefined || matchStart === undefined) continue;
    const bodyOffset = match[0].indexOf(body);
    const start = matchStart + bodyOffset;
    copyRange(source, output, start, start + body.length);
    copied = true;
  }

  if (!copied && filePath.toLowerCase().endsWith(".astro")) {
    const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/u.exec(source);
    const body = frontmatter?.[1];
    if (body !== undefined && frontmatter?.index !== undefined) {
      const start = frontmatter.index + frontmatter[0].indexOf(body);
      copyRange(source, output, start, start + body.length);
    }
  }

  return output.join("");
}

function copyRange(
  source: string,
  output: string[],
  start: number,
  end: number,
): void {
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (character !== undefined) output[index] = character;
  }
}

function frameworkForExtension(filePath: string): string {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".vue")) return "vue-family";
  if (normalized.endsWith(".svelte")) return "svelte-family";
  return "astro";
}
