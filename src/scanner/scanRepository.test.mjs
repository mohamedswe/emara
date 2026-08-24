import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import {
  detectLanguageFromPath,
  scanRepository,
} from "./scanRepository.ts";

const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((repositoryPath) =>
      rm(repositoryPath, { recursive: true, force: true }),
    ),
  );
});

test("scans regular files with normalized paths, languages, and SHA-256 hashes", async () => {
  const repositoryPath = await createTemporaryRepository();
  const fixtures = {
    "README.md": "# Example\n",
    "assets/data.bin": "binary-ish-data",
    "src/component.tsx": "export function Component() {}\n",
    "src/index.cjs": "module.exports = {};\n",
    "src/settings.yaml": "enabled: true\n",
  };

  for (const [relativePath, content] of Object.entries(fixtures)) {
    await writeFixture(repositoryPath, relativePath, content);
  }

  const files = await scanRepository(repositoryPath);

  assert.deepEqual(
    files.map((file) => file.path),
    Object.keys(fixtures).sort(compareStrings),
  );
  assert.ok(files.every((file) => !file.path.includes("\\")));

  assert.deepEqual(
    Object.fromEntries(files.map((file) => [file.path, file.language])),
    {
      "README.md": "markdown",
      "assets/data.bin": "unknown",
      "src/component.tsx": "typescript",
      "src/index.cjs": "javascript",
      "src/settings.yaml": "yaml",
    },
  );

  for (const file of files) {
    assert.equal(
      file.contentHash,
      createHash("sha256").update(fixtures[file.path]).digest("hex"),
    );
    assert.equal(
      file.lineCount,
      fixtures[file.path].split("\n").length,
    );
  }
});

test("excludes repository metadata and installed dependencies", async () => {
  const repositoryPath = await createTemporaryRepository();

  await writeFixture(repositoryPath, ".git/config", "ignored");
  await writeFixture(
    repositoryPath,
    "node_modules/package/index.js",
    "ignored",
  );
  await writeFixture(repositoryPath, "src/index.ts", "export {};\n");

  const files = await scanRepository(repositoryPath);

  assert.deepEqual(files.map((file) => file.path), ["src/index.ts"]);
});

test("excludes generated build, framework, and Python environment directories", async () => {
  const repositoryPath = await createTemporaryRepository();
  await writeFixture(repositoryPath, "src/app.py", "print('kept')\n");
  for (const path of [
    ".venv/lib/package.py",
    "venv/lib/package.py",
    "src/__pycache__/app.pyc",
    ".pytest_cache/state.json",
    ".mypy_cache/state.json",
    ".ruff_cache/state.json",
    ".expo/state.json",
    ".next/server/app.js",
    "coverage/report.json",
    "build/app.js",
    "dist/app.js",
    "web-build/app.js",
  ]) {
    await writeFixture(repositoryPath, path, "generated\n");
  }

  const files = await scanRepository(repositoryPath);

  assert.deepEqual(files.map((file) => file.path), ["src/app.py"]);
});

test("excludes environment files at every directory depth", async () => {
  const repositoryPath = await createTemporaryRepository();

  await writeFixture(repositoryPath, ".env", "SECRET=root\n");
  await writeFixture(repositoryPath, ".env.example", "SECRET=\n");
  await writeFixture(repositoryPath, ".env.local", "SECRET=local\n");
  await writeFixture(repositoryPath, "server/.env.production", "SECRET=prod\n");
  await writeFixture(repositoryPath, "src/index.ts", "export {};\n");

  const files = await scanRepository(repositoryPath);

  assert.deepEqual(files.map((file) => file.path), ["src/index.ts"]);
});

test("excludes the Git metadata file used by linked worktrees", async () => {
  const repositoryPath = await createTemporaryRepository();

  await writeFixture(repositoryPath, ".git", "gitdir: elsewhere\n");
  await writeFixture(repositoryPath, "src/index.ts", "export {};\n");

  const files = await scanRepository(repositoryPath);

  assert.deepEqual(files.map((file) => file.path), ["src/index.ts"]);
});

test("returns identical output for an unchanged repository", async () => {
  const repositoryPath = await createTemporaryRepository();
  await writeFixture(repositoryPath, "src/index.ts", "export const value = 1;\n");

  const firstScan = await scanRepository(repositoryPath);
  const secondScan = await scanRepository(repositoryPath);

  assert.deepEqual(secondScan, firstScan);
});

test("rejects empty, missing, and non-directory repository paths", async () => {
  await assert.rejects(scanRepository(""), /must not be empty/);

  const repositoryPath = await createTemporaryRepository();
  await assert.rejects(
    scanRepository(join(repositoryPath, "missing")),
    /Unable to access repository path/,
  );

  const filePath = join(repositoryPath, "file.txt");
  await writeFile(filePath, "content");
  await assert.rejects(scanRepository(filePath), /is not a directory/);
});

test("detects supported extensions case-insensitively", () => {
  assert.equal(detectLanguageFromPath("source.MTS"), "typescript");
  assert.equal(detectLanguageFromPath("source.JSX"), "javascript");
  assert.equal(detectLanguageFromPath("source.PY"), "python");
  assert.equal(detectLanguageFromPath("notebook.IPYNB"), "jupyter");
  assert.equal(detectLanguageFromPath("component.VUE"), "vue");
  assert.equal(detectLanguageFromPath("component.SVELTE"), "svelte");
  assert.equal(detectLanguageFromPath("page.ASTRO"), "astro");
  assert.equal(detectLanguageFromPath("source.unknown"), "unknown");
});

async function createTemporaryRepository() {
  const repositoryPath = await mkdtemp(
    join(tmpdir(), "software-auditor-scanner-"),
  );
  temporaryRepositories.push(repositoryPath);
  return repositoryPath;
}

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  const directoryPath = dirname(filePath);

  if (directoryPath !== repositoryPath) {
    await mkdir(directoryPath, { recursive: true });
  }

  await writeFile(filePath, content);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
