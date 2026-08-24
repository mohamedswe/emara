import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join, relative, resolve, sep } from "node:path";

import type { ScannedFile } from "./types.js";

const EXCLUDED_ENTRY_NAMES = new Set([
  ".expo",
  ".git",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "venv",
  "web-build",
]);

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".cjs": "javascript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".mjs": "javascript",
  ".mts": "typescript",
  ".ipynb": "jupyter",
  ".py": "python",
  ".pyi": "python",
  ".pyw": "python",
  ".astro": "astro",
  ".svelte": "svelte",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".vue": "vue",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export function detectLanguageFromPath(filePath: string): string {
  return LANGUAGE_BY_EXTENSION[extname(filePath).toLowerCase()] ?? "unknown";
}

export async function scanRepository(repositoryPath: string): Promise<ScannedFile[]> {
  if (repositoryPath.length === 0) {
    throw new Error("Repository path must not be empty");
  }

  const requestedRoot = resolve(repositoryPath);
  let rootStats;

  try {
    rootStats = await stat(requestedRoot);
  } catch (error) {
    throw new Error(`Unable to access repository path: ${requestedRoot}`, {
      cause: error,
    });
  }

  if (!rootStats.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${requestedRoot}`);
  }

  const repositoryRoot = await realpath(requestedRoot);
  const files: ScannedFile[] = [];

  await walkDirectory(repositoryRoot, repositoryRoot, files);
  files.sort((left, right) => compareStrings(left.path, right.path));

  return files;
}

async function walkDirectory(
  repositoryRoot: string,
  directoryPath: string,
  files: ScannedFile[],
): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  entries.sort((left, right) => compareStrings(left.name, right.name));

  for (const entry of entries) {
    if (isExcludedEntryName(entry.name)) {
      continue;
    }

    const absolutePath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(repositoryRoot, absolutePath, files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const normalizedPath = normalizeRelativePath(repositoryRoot, absolutePath);
    const metadata = await inspectFile(absolutePath);
    files.push({
      path: normalizedPath,
      language: detectLanguageFromPath(normalizedPath),
      contentHash: metadata.contentHash,
      lineCount: metadata.lineCount,
    });
  }
}

function isExcludedEntryName(entryName: string): boolean {
  const normalizedName = entryName.toLowerCase();
  return (
    EXCLUDED_ENTRY_NAMES.has(normalizedName) ||
    normalizedName === ".env" ||
    normalizedName.startsWith(".env.")
  );
}

function normalizeRelativePath(
  repositoryRoot: string,
  absolutePath: string,
): string {
  return relative(repositoryRoot, absolutePath).split(sep).join("/");
}

async function inspectFile(
  filePath: string,
): Promise<{ contentHash: string; lineCount: number }> {
  const hash = createHash("sha256");
  let lineCount = 1;

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (const byte of bytes) {
      if (byte === 0x0a) lineCount += 1;
    }
  }

  return { contentHash: hash.digest("hex"), lineCount };
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
