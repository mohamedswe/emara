import { spawn } from "node:child_process";
import { createReadStream, type Stats } from "node:fs";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join, relative, resolve, sep } from "node:path";

import type { ScannedFile } from "./types.js";
import { compareText as compareStrings } from "../shared/compare.ts";

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

const MAX_CONCURRENT_FILE_READS = 32;

export interface ScanRepositoryOptions {
  /**
   * Files for which the raw bytes are retained (read once, then hashed and
   * line-counted from the same buffer) so callers need not read them again.
   */
  retainContent?: (file: ScannedFile) => boolean;
}

export interface ScannedRepository {
  files: ScannedFile[];
  /** Raw bytes of retained files, keyed by normalized path. */
  contents: Map<string, Buffer>;
}

export async function scanRepository(repositoryPath: string): Promise<ScannedFile[]> {
  return (await scanRepositoryWithContents(repositoryPath)).files;
}

/**
 * Lists repository files deterministically. In a Git work tree this is
 * `git ls-files --cached --others --exclude-standard` (tracked files plus
 * untracked files that are not ignored); submodule directories and non-Git
 * folders use the directory walk. Both modes apply the same built-in
 * exclusions (dependency/build directories and `.env*`) and never follow
 * symbolic links.
 */
export async function scanRepositoryWithContents(
  repositoryPath: string,
  options: ScanRepositoryOptions = {},
): Promise<ScannedRepository> {
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
  const gitPaths = await listGitPaths(repositoryRoot);
  // An empty listing also happens when the root is itself ignored by an
  // enclosing repository; never report an empty repository in that case.
  const paths = gitPaths === undefined || gitPaths.length === 0
    ? await walkDirectory(repositoryRoot, repositoryRoot)
    : await regularGitFiles(repositoryRoot, gitPaths);
  paths.sort(compareStrings);

  const files: ScannedFile[] = new Array(paths.length);
  const contents = new Map<string, Buffer>();
  await forEachWithConcurrency(paths, MAX_CONCURRENT_FILE_READS, async (path, index) => {
    const language = detectLanguageFromPath(path);
    const absolutePath = join(repositoryRoot, ...path.split("/"));
    const retain = options.retainContent?.({ path, language, contentHash: "" }) === true;
    const metadata = retain
      ? inspectBuffer(await readFile(absolutePath))
      : await inspectStream(absolutePath);
    files[index] = {
      path,
      language,
      contentHash: metadata.contentHash,
      lineCount: metadata.lineCount,
    };
    if (metadata.buffer !== undefined) contents.set(path, metadata.buffer);
  });

  return { files, contents };
}

async function walkDirectory(
  repositoryRoot: string,
  directoryPath: string,
  paths: string[] = [],
): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  entries.sort((left, right) => compareStrings(left.name, right.name));

  for (const entry of entries) {
    if (isExcludedEntryName(entry.name)) {
      continue;
    }

    const absolutePath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(repositoryRoot, absolutePath, paths);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    paths.push(normalizeRelativePath(repositoryRoot, absolutePath));
  }
  return paths;
}

/**
 * Keeps only regular files reached without crossing a symlink, mirroring the
 * walk. Tracked entries that are directories are submodules (gitlinks); they
 * are walked like non-Git folders. Tracked-but-deleted entries are skipped.
 */
async function regularGitFiles(
  repositoryRoot: string,
  gitPaths: readonly string[],
): Promise<string[]> {
  const paths: string[] = [];
  const directoryKinds = new Map<string, "directory" | "skip">();
  for (const path of [...new Set(gitPaths)].sort(compareStrings)) {
    const parts = path.split("/");
    if (parts.some((part) => part.length === 0 || part === "." || part === ".." || isExcludedEntryName(part))) {
      continue;
    }
    let current = repositoryRoot;
    let reachable = true;
    for (const part of parts.slice(0, -1)) {
      current = join(current, part);
      let kind = directoryKinds.get(current);
      if (kind === undefined) {
        const stats = await lstatIfPresent(current);
        kind = stats?.isDirectory() === true ? "directory" : "skip";
        directoryKinds.set(current, kind);
      }
      if (kind === "skip") {
        reachable = false;
        break;
      }
    }
    if (!reachable) continue;
    const absolutePath = join(repositoryRoot, ...parts);
    const stats = await lstatIfPresent(absolutePath);
    if (stats?.isFile() === true) {
      paths.push(path);
    } else if (stats?.isDirectory() === true) {
      await walkDirectory(repositoryRoot, absolutePath, paths);
    }
  }
  return paths;
}

async function lstatIfPresent(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

/** Returns undefined when Git is unavailable or the root is not in a work tree. */
async function listGitPaths(repositoryRoot: string): Promise<string[] | undefined> {
  return await new Promise((resolvePaths, reject) => {
    const child = spawn(
      "git",
      [
        "-c",
        `safe.directory=${repositoryRoot.split(sep).join("/")}`,
        "-C",
        repositoryRoot,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        ".",
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let errorText = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      errorText = `${errorText}${chunk.toString("utf8")}`.slice(0, 4_096);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") resolvePaths(undefined);
      else reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolvePaths(
          Buffer.concat(chunks).toString("utf8").split(NUL).filter((path) => path.length > 0),
        );
      } else if (/not a git repository/iu.test(errorText)) {
        resolvePaths(undefined);
      } else {
        reject(new Error(`Unable to list Git files in ${repositoryRoot}: ${errorText.trim()}`));
      }
    });
  });
}

const NUL = String.fromCharCode(0);

async function forEachWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) await worker(item, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
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

function inspectBuffer(
  buffer: Buffer,
): { contentHash: string; lineCount: number; buffer: Buffer } {
  return {
    contentHash: createHash("sha256").update(buffer).digest("hex"),
    lineCount: 1 + countNewlines(buffer),
    buffer,
  };
}

async function inspectStream(
  filePath: string,
): Promise<{ contentHash: string; lineCount: number; buffer?: undefined }> {
  const hash = createHash("sha256");
  let lineCount = 1;

  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(bytes);
    lineCount += countNewlines(bytes);
  }

  return { contentHash: hash.digest("hex"), lineCount };
}

function countNewlines(bytes: Buffer): number {
  let count = 0;
  for (let index = bytes.indexOf(0x0a); index !== -1; index = bytes.indexOf(0x0a, index + 1)) {
    count += 1;
  }
  return count;
}
