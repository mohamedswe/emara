import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import { findDeadCodeCandidates } from "./findDeadCodeCandidates.ts";
import { findUnusedImportCandidates } from "./findUnusedImportCandidates.ts";
import {
  IneligibleCandidateError,
  prepareDeadCodeValidationBaseline,
  validateDeadCodeCandidate,
} from "./validateDeadCodeCandidate.ts";

test("promotes a disconnected file only after isolated commands and feature fingerprint pass", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const candidate = findDeadCodeCandidates(graph).find((value) =>
    value.file === "dead.js"
  );
  assert.ok(candidate);

  const result = await validateDeadCodeCandidate(
    graph,
    repositoryPath,
    candidate,
    [{ command: process.execPath, args: ["--check", "app.js"] }],
  );

  assert.equal(result.candidate.verdict, "VALIDATED_SAFE_TO_DELETE");
  assert.equal(result.candidate.validation?.passed, true);
  assert.equal(
    result.candidate.validation?.featureFingerprintUnchanged,
    true,
  );
});

test("keeps a candidate validation-required when an isolated command fails", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const candidate = findDeadCodeCandidates(graph).find((value) =>
    value.file === "dead.js"
  );
  assert.ok(candidate);

  const result = await validateDeadCodeCandidate(
    graph,
    repositoryPath,
    candidate,
    [{ command: process.execPath, args: ["--check", "missing.js"] }],
  );

  assert.equal(result.candidate.verdict, "VALIDATION_REQUIRED");
  assert.equal(result.candidate.validation?.passed, false);
  assert.notEqual(result.commandResults[0]?.exitCode, 0);
});

test("removes one unused Python import binding in isolation", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "delete-import-fixture-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "service.py",
    [
      "from models import Used, Unused",
      "def handler():",
      "    return Used()",
    ].join("\n"),
  );
  await writeFixture(repositoryPath, "models.py", "class Used:\n    pass\nclass Unused:\n    pass");
  const { graph } = await indexRepository(repositoryPath);
  const candidate = (await findUnusedImportCandidates(graph, repositoryPath))
    .find((value) => value.symbol === "Unused");
  assert.ok(candidate);

  const result = await validateDeadCodeCandidate(
    graph,
    repositoryPath,
    candidate,
    [{
      command: process.execPath,
      args: [
        "-e",
        "const s=require('fs').readFileSync('service.py','utf8');if(/import[^\\n]*Unused/.test(s))process.exit(1)",
      ],
    }],
  );

  assert.equal(result.candidate.verdict, "VALIDATED_SAFE_TO_DELETE");
});

test("rejects structurally ineligible candidates with a typed IneligibleCandidateError", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const candidate = findDeadCodeCandidates(graph).find((value) => value.file === "dead.js");
  assert.ok(candidate);
  const command = [{ command: process.execPath, args: ["--version"] }];

  await assert.rejects(
    validateDeadCodeCandidate(graph, repositoryPath, { ...candidate, id: "dead-import:dead.js::dormant" }, command),
    (error) => error instanceof IneligibleCandidateError && /Python files only/u.test(error.message),
  );
  const reachable = findDeadCodeCandidates(graph).find((value) => value.file === "dead.js");
  await assert.rejects(
    validateDeadCodeCandidate(graph, repositoryPath, { ...reachable, file: "app.js" }, command),
    (error) => error instanceof IneligibleCandidateError && /disconnected_candidate reachability/u.test(error.message),
  );
});

test("timeout terminates a sleeping grandchild and reports the timeout", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const candidate = findDeadCodeCandidates(graph).find((value) => value.file === "dead.js");
  assert.ok(candidate);
  const result = await validateDeadCodeCandidate(graph, repositoryPath, candidate, [{
    command: process.execPath,
    args: ["-e", "const {spawn}=require('child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000)"],
    timeoutMs: 1_500,
  }]);
  const command = result.commandResults[0];
  const pid = Number(command?.stdout.trim());
  assert.ok(Number.isSafeInteger(pid) && pid > 0, "grandchild PID must be reported");
  context.after(() => killQuietly(pid));
  assert.equal(await processGone(pid), true, "grandchild must not survive the timeout");
  assert.equal(command.exitCode, 124);
  assert.match(command.stderr, /timed out after 1500ms/u);
  assert.equal(result.candidate.validation?.passed, false);
});

test("a command that exits cannot leave a descendant running (POSIX process group)", { skip: process.platform === "win32" && "Windows has no process-group containment without a Job Object" }, async (context) => {
  const repositoryPath = await fixtureRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const candidate = findDeadCodeCandidates(graph).find((value) => value.file === "dead.js");
  assert.ok(candidate);
  const result = await validateDeadCodeCandidate(graph, repositoryPath, candidate, [{
    command: process.execPath,
    args: ["-e", "const {spawn}=require('child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});child.unref();console.log(child.pid)"],
  }]);
  const command = result.commandResults[0];
  const pid = Number(command?.stdout.trim());
  assert.ok(Number.isSafeInteger(pid) && pid > 0, "descendant PID must be reported");
  context.after(() => killQuietly(pid));
  assert.equal(await processGone(pid), true, "descendant must not survive its parent");
  assert.equal(command.exitCode, 0);
  assert.equal(result.candidate.verdict, "VALIDATED_SAFE_TO_DELETE");
});

test("refuses to copy a symlink that points outside the repository", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  const outside = await mkdtemp(join(tmpdir(), "delete-validation-outside-"));
  context.after(() => rm(outside, { recursive: true, force: true }));
  if (process.platform === "win32") {
    await symlink(outside, join(repositoryPath, "escape"), "junction");
  } else {
    await symlink(relative(repositoryPath, outside), join(repositoryPath, "escape"), "dir");
  }
  const { graph } = await indexRepository(repositoryPath);
  const candidate = findDeadCodeCandidates(graph).find((value) => value.file === "dead.js");
  assert.ok(candidate);

  await assert.rejects(
    validateDeadCodeCandidate(graph, repositoryPath, candidate, [{
      command: process.execPath,
      args: ["-e", "require('fs').writeFileSync('escape/pwned.txt','x')"],
    }]),
    /Refusing to copy symlink .*escape/u,
  );
  assert.deepEqual(await readdir(outside), []);
});

test("an in-repository relative symlink cannot write through to the original repository", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  await writeFixture(repositoryPath, "src/value.txt", "original\n");
  try {
    await symlink("src", join(repositoryPath, "lib"), "dir");
  } catch (error) {
    if (error.code === "EPERM") return context.skip("creating symlinks requires Developer Mode on Windows");
    throw error;
  }
  const { graph } = await indexRepository(repositoryPath);
  const candidate = findDeadCodeCandidates(graph).find((value) => value.file === "dead.js");
  assert.ok(candidate);

  const result = await validateDeadCodeCandidate(graph, repositoryPath, candidate, [{
    command: process.execPath,
    args: ["-e", "require('fs').writeFileSync('lib/value.txt','MUTATED')"],
  }]);

  assert.equal(result.commandResults[0]?.exitCode, 0);
  assert.equal(await readFile(join(repositoryPath, "src", "value.txt"), "utf8"), "original\n");
});

test("a prepared baseline is reused instead of re-deriving the fingerprint and ledger per candidate", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  await writeFixture(repositoryPath, "other.js", "export function otherDormant() {}");
  const { graph } = await indexRepository(repositoryPath);
  const candidates = findDeadCodeCandidates(graph).filter((value) => ["dead.js", "other.js"].includes(value.file));
  assert.equal(candidates.length, 2);
  const baseline = prepareDeadCodeValidationBaseline(graph);
  let versionReads = 0;
  Object.defineProperty(graph, "version", { configurable: true, get() { versionReads += 1; return 4; } });

  for (const candidate of candidates) {
    const other = candidate.file === "dead.js" ? "other.js" : "dead.js";
    const result = await validateDeadCodeCandidate(graph, repositoryPath, candidate, [{
      command: process.execPath,
      // Each candidate must get a fresh copy: no marker from a previous run,
      // and the other candidate's file still present.
      args: ["-e", `const fs=require('fs');if(fs.existsSync('mutation.txt')||!fs.existsSync(${JSON.stringify(other)}))process.exit(1);fs.writeFileSync('mutation.txt','x')`],
    }], baseline);
    assert.equal(result.candidate.validation?.passed, true, candidate.file);
  }
  assert.equal(versionReads, 0, "baseline graph must not be re-analyzed per candidate");

  const tampered = { ...baseline, fingerprint: "not-the-real-fingerprint" };
  const result = await validateDeadCodeCandidate(graph, repositoryPath, candidates[0], [{ command: process.execPath, args: ["--version"] }], tampered);
  assert.equal(result.candidate.validation?.featureFingerprintUnchanged, false);

  const { graph: otherGraph } = await indexRepository(repositoryPath);
  await assert.rejects(
    validateDeadCodeCandidate(otherGraph, repositoryPath, candidates[0], [{ command: process.execPath, args: ["--version"] }], baseline),
    /baseline was prepared for a different graph/u,
  );
});

function killQuietly(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function processGone(pid) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return true;
      throw error;
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  return false;
}

async function fixtureRepository(context) {
  const repositoryPath = await mkdtemp(join(tmpdir(), "delete-validation-fixture-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "app.js",
    [
      "function health() { return { ok: true }; }",
      "router.get('/health', health);",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "dead.js",
    "export function dormant() { return 'unused'; }",
  );
  return repositoryPath;
}

async function writeFixture(repositoryPath, relativePath, content) {
  const path = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${content}\n`);
}
