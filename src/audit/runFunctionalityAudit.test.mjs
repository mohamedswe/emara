import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  parseArguments,
  parseValidationCommand,
  runFunctionalityAuditCli,
} from "./runFunctionalityAudit.ts";

test("defaults to deterministic even when a model key is present", (context) => {
  const previous = process.env.DEEPSEEK_API_KEY;
  context.after(() => {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  });
  process.env.DEEPSEEK_API_KEY = "test-key";
  assert.equal(parseArguments(["fixture-repository"]).deterministic, true);
});

test("only explicit --model-assisted opts in to model egress", () => {
  assert.equal(parseArguments(["fixture-repository", "--model", "custom"]).deterministic, true);
  assert.equal(parseArguments(["fixture-repository", "--model-assisted", "--model", "custom"]).deterministic, false);
});

test("rejects conflicting egress mode flags in either order", () => {
  for (const flags of [["--deterministic", "--model-assisted"], ["--model-assisted", "--deterministic"]]) {
    assert.throws(() => parseArguments(["fixture-repository", ...flags]), /cannot combine.*--deterministic.*--model-assisted/i);
  }
});

test("defaults output artifacts inside the target repository", () => {
  const repositoryPath = resolve("fixture-repository");
  const options = parseArguments([repositoryPath, "--deterministic"]);

  assert.equal(options.repositoryPath, repositoryPath);
  assert.equal(
    options.outputPath,
    resolve(repositoryPath, "audit-output", "functionality-audit.json"),
  );
  assert.equal(
    options.graphPath,
    resolve(repositoryPath, "audit-output", "graph.json"),
  );
  assert.equal(options.deterministic, true);
  assert.equal(options.validateDeadCode, false);
  assert.deepEqual(options.validationCommands, []);
});

test("accepts deterministic as a valueless flag among valued options", () => {
  const options = parseArguments([
    "fixture-repository",
    "--model=deepseek-chat",
    "--deterministic",
    "--expected-commit",
    "abc123",
  ]);

  assert.equal(options.deterministic, true);
  assert.equal(options.model, "deepseek-chat");
  assert.equal(options.expectedCommit, "abc123");
});

test("parses --validate-dead-code and repeatable --validation-command flags", () => {
  const options = parseArguments([
    "fixture-repository",
    "--deterministic",
    "--validate-dead-code",
    '--validation-command=lint::node --check app.js',
    "--validation-command",
    "test::npm test",
    "--validation-command",
    "node --version",
  ]);

  assert.equal(options.validateDeadCode, true);
  assert.equal(options.validationCommands.length, 3);
  assert.deepEqual(options.validationCommands[0], {
    command: "node",
    args: ["--check", "app.js"],
    label: "lint",
  });
  assert.deepEqual(options.validationCommands[1], {
    command: "npm",
    args: ["test"],
    label: "test",
  });
  assert.deepEqual(options.validationCommands[2], {
    command: "node",
    args: ["--version"],
  });
});

test("parseValidationCommand handles quotes and empty errors", () => {
  assert.throws(
    () => parseValidationCommand(""),
    /Validation command must not be empty/,
  );
  assert.throws(
    () => parseValidationCommand("label::"),
    /Validation command must not be empty/,
  );

  const parsed = parseValidationCommand(
    'build::"C:/Program Files/Node/node.exe" -e "process.exit(0)"',
  );
  assert.equal(parsed.label, "build");
  assert.equal(parsed.command, "C:/Program Files/Node/node.exe");
  assert.deepEqual(parsed.args, ["-e", "process.exit(0)"]);
});

test("runs deterministic audit with --validate-dead-code promoting disconnected candidate", async (context) => {
  const repositoryPath = await createFixtureRepo(context);
  const auditPath = join(repositoryPath, "audit-output", "functionality-audit.json");
  const reportPath = join(repositoryPath, "audit-output", "audit-report.md");

  await runFunctionalityAuditCli([
    repositoryPath,
    "--deterministic",
    "--validate-dead-code",
    `--validation-command=check::"${process.execPath}" --check app.js`,
  ]);

  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  assert.equal(audit.summary.validated_safe_to_delete, 1);
  assert.equal(audit.summary.ready_for_delete_validation, 0);

  const deadCandidate = audit.deadCodeCandidates.find((c) => c.file === "dead.js");
  assert.ok(deadCandidate, "dead.js candidate must exist");
  assert.equal(deadCandidate.verdict, "VALIDATED_SAFE_TO_DELETE");
  assert.equal(deadCandidate.validation?.passed, true);
  assert.deepEqual(deadCandidate.validation?.commands, ["check"]);
  assert.equal(deadCandidate.validation?.featureFingerprintUnchanged, true);

  const report = await readFile(reportPath, "utf8");
  assert.match(report, /## Validated safe to delete/u);
  assert.match(report, /`dead\.js::dormant`/u);
  assert.match(report, /Commands run: `check`/u);
  assert.match(report, /Feature fingerprint: unchanged/u);
});

test("runs deterministic audit with failing validation command keeping candidate unpromoted", async (context) => {
  const repositoryPath = await createFixtureRepo(context);
  const auditPath = join(repositoryPath, "audit-output", "functionality-audit.json");
  const reportPath = join(repositoryPath, "audit-output", "audit-report.md");

  await runFunctionalityAuditCli([
    repositoryPath,
    "--deterministic",
    "--validate-dead-code",
    `--validation-command=failing-check::"${process.execPath}" --check nonexistent_file.js`,
  ]);

  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  assert.equal(audit.summary.validated_safe_to_delete, 0);
  assert.equal(audit.summary.ready_for_delete_validation, 1);

  const deadCandidate = audit.deadCodeCandidates.find((c) => c.file === "dead.js");
  assert.ok(deadCandidate, "dead.js candidate must exist");
  assert.equal(deadCandidate.verdict, "VALIDATION_REQUIRED");
  assert.equal(deadCandidate.validation?.passed, false);

  const report = await readFile(reportPath, "utf8");
  assert.match(report, /## Validated safe to delete\n\nNone\./u);
});

test("model opt-in emits an endpoint egress notice on stderr before work", async (context) => {
  const repositoryPath = await createFixtureRepo(context);
  const previous = { key: process.env.DEEPSEEK_API_KEY, url: process.env.DEEPSEEK_BASE_URL };
  context.after(() => {
    for (const [name, value] of [["DEEPSEEK_API_KEY", previous.key], ["DEEPSEEK_BASE_URL", previous.url]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_BASE_URL = "https://example.test/v1/";
  const notices = [];
  const stop = new Error("stop before any network request");
  context.mock.method(console, "log", () => { throw stop; });
  context.mock.method(console, "error", (message) => { notices.push(message); throw stop; });
  await assert.rejects(runFunctionalityAuditCli([repositoryPath, "--model-assisted"]), (error) => error === stop);
  assert.match(notices[0], /egress.*source.*https:\/\/example.test\/v1\/chat\/completions/i);
  assert.equal(notices[0].includes("test-key"), false);
});

test("Docker forwards explicit mode flags without inferring consent from credentials", async () => {
  const script = await readFile(new URL("../../bin/docker-entrypoint.sh", import.meta.url), "utf8");
  assert.equal(script.includes("DEEPSEEK_API_KEY"), false);
  assert.match(script, /exec node.*"\$@"/u);
});

async function createFixtureRepo(context) {
  const repositoryPath = await mkdtemp(join(tmpdir(), "cli-delete-validation-"));
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
  execFileSync("git", ["init"], { cwd: repositoryPath, windowsHide: true });
  execFileSync("git", ["config", "user.name", "Test User"], {
    cwd: repositoryPath,
    windowsHide: true,
  });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repositoryPath,
    windowsHide: true,
  });
  execFileSync("git", ["add", "."], { cwd: repositoryPath, windowsHide: true });
  execFileSync("git", ["commit", "-m", "init"], {
    cwd: repositoryPath,
    windowsHide: true,
  });
  return repositoryPath;
}

async function writeFixture(repositoryPath, relativePath, content) {
  const path = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${content}\n`, "utf8");
}
