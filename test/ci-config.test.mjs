import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseDocument } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
function workflow(name) {
  const document = parseDocument(readFileSync(join(root, '.github/workflows', name), 'utf8'), { uniqueKeys: true });
  assert.deepEqual(document.errors, [], `${name} must be valid YAML`);
  return document.toJS();
}

test('CI verifies Node 22 and 24 on pushes, pull requests and reusable calls', () => {
  const ci = workflow('ci.yml');
  for (const event of ['push', 'pull_request', 'workflow_call']) assert.ok(event in ci.on);
  assert.deepEqual(ci.permissions, { contents: 'read' });
  const verify = ci.jobs.verify;
  assert.deepEqual(verify.strategy.matrix.node, [22, 24]);
  assert.equal(verify['runs-on'], 'ubuntu-latest');
  const steps = verify.steps;
  assert.ok(steps.some(step => step.uses === 'actions/checkout@v4'));
  const setup = steps.find(step => step.uses === 'actions/setup-node@v4');
  assert.equal(setup.with['node-version'], '${{ matrix.node }}');
  assert.equal(setup.with.cache, 'npm');
  assert.deepEqual(steps.filter(step => step.run).map(step => step.run), [
    'npm ci',
    'node scripts/check-conflict-markers.mjs',
    'npm run typecheck',
    'npm test',
  ]);
});

test('tracked conflict checking rejects conflicts but accepts marker literals and untracked fixtures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'auditor-conflicts-'));
  const marker = character => character.repeat(7);
  const conflict = `${marker('<')} HEAD\nours\n${marker('=')}\ntheirs\n${marker('>')} branch\n`;
  try {
    execFileSync('git', ['init', '--quiet', directory]);
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: directory });
    mkdirSync(join(directory, 'test'));
    writeFileSync(join(directory, 'test', 'fixture.mjs'), `const fixture = ${JSON.stringify(conflict)};\n`);
    writeFileSync(join(directory, 'notes.md'), `A heading\n${marker('=')}\n`);
    writeFileSync(join(directory, 'untracked.txt'), conflict);
    execFileSync('git', ['add', 'test/fixture.mjs', 'notes.md'], { cwd: directory });
    const run = () => spawnSync(process.execPath, [join(root, 'scripts/check-conflict-markers.mjs')], { cwd: directory, encoding: 'utf8' });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(join(directory, 'broken file.ts'), conflict);
    execFileSync('git', ['add', 'broken file.ts'], { cwd: directory });
    result = run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /broken file\.ts:1/);
    assert.doesNotMatch(result.stderr, /untracked\.txt|fixture\.mjs|notes\.md/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('publishing waits for reusable verification and restricts registry write access', () => {
  const publish = workflow('publish-auditor-image.yml');
  assert.equal(publish.jobs.verify.uses, './.github/workflows/ci.yml');
  assert.deepEqual(publish.permissions, { contents: 'read' });
  const job = publish.jobs.publish;
  assert.deepEqual(job.needs, ['verify']);
  assert.equal(job.if, "github.ref == 'refs/heads/main'");
  assert.deepEqual(job.permissions, { contents: 'read', packages: 'write' });
  const build = job.steps.find(step => step.uses === 'docker/build-push-action@v6');
  assert.equal(build.with.push, true);
  assert.deepEqual(build.with.tags.trim().split('\n'), [
    '${{ env.IMAGE_NAME }}:sha-${{ github.sha }}',
    '${{ env.IMAGE_NAME }}:latest',
  ]);
  for (const path of ['.github/workflows/ci.yml', 'scripts/**', 'test/**']) {
    assert.ok(publish.on.push.paths.includes(path), `Publishing must react to ${path}`);
  }
});

test('container keeps build tools out of runtime and has an executable launcher', () => {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const runtime = dockerfile.split(/FROM node:22-slim AS runtime/u)[1];
  assert.ok(runtime);
  assert.doesNotMatch(runtime, /apt-get install[^\n]*(?:g\+\+|make|python3)/u);
  assert.match(dockerfile, /npm prune --omit=dev/u);
  assert.match(runtime, /chmod \+x \/app\/bin\/auditor\.mjs \/app\/bin\/docker-entrypoint\.sh/u);
  assert.match(runtime, /ENTRYPOINT \["\/app\/bin\/docker-entrypoint\.sh"\]/u);
});

test('all existing workflows remain valid YAML', () => {
  workflow('deploy-demo.yml');
  workflow('publish-auditor-image.yml');
});
