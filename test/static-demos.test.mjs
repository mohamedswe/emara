import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildStaticDemos } from '../src/map/buildStaticDemos.ts';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const filenames = ['.nojekyll', 'bulletproof-react.html', 'fastapi-template.html', 'index.html', 'uptime-kuma.html'];

test('invalid pinned inputs fail closed before writing any output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'emara-invalid-demos-'));
  const inputDir = join(directory, 'inputs');
  const outputDir = join(directory, 'output');
  const original = new URL('../demo-data/', import.meta.url);
  try {
    await assert.rejects(buildStaticDemos({ inputDir, outputDir }), /ENOENT/u);
    await assert.rejects(readdir(outputDir), /ENOENT/u);
    await cp(original, inputDir, { recursive: true });
    const input = join(inputDir, 'uptime-kuma.json');
    await rm(input);
    await assert.rejects(buildStaticDemos({ inputDir, outputDir }), /ENOENT/u);
    await assert.rejects(readdir(outputDir), /ENOENT/u);
    await writeFile(input, '{');
    await assert.rejects(buildStaticDemos({ inputDir, outputDir }), /Invalid demo input uptime-kuma/u);
    await assert.rejects(readdir(outputDir), /ENOENT/u);
    await cp(original, inputDir, { recursive: true });
    const text = await readFile(input, 'utf8');
    await writeFile(input, text.replace('louislam/uptime-kuma', 'tampered/repository'));
    await assert.rejects(buildStaticDemos({ inputDir, outputDir }), /Invalid demo input uptime-kuma/u);
    await assert.rejects(readdir(outputDir), /ENOENT/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pinned demos build every page deterministically with no raw < in JSON script data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'emara-demos-'));
  try {
    const outputDir = join(directory, 'output');
    await buildStaticDemos({ outputDir });
    assert.deepEqual((await readdir(outputDir)).sort(), filenames);
    const first = new Map();
    for (const filename of filenames) {
      const html = await readFile(join(outputDir, filename), 'utf8');
      first.set(filename, html);
      if (!filename.endsWith('.html')) continue;
      const scripts = [...html.matchAll(/<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gu)];
      assert.equal(scripts.length, 1, filename);
      assert.ok(!scripts[0][1].includes('<'), `${filename}: raw < in JSON script`);
      const boot = JSON.parse(scripts[0][1]);
      assert.equal(boot.sessionToken, null);
      assert.equal(boot.presets.length, 3);
      for (const preset of boot.presets) assert.ok(filenames.includes(preset.url));
      if (filename !== 'index.html') {
        assert.ok(boot.initialPayload.featureMap.blocks.length > 0);
        assert.match(boot.initialPayload.featureMap.repositoryCommit, /^[a-f0-9]{40}$/u);
      }
    }
    await buildStaticDemos({ outputDir });
    for (const filename of filenames) {
      assert.equal(await readFile(join(outputDir, filename), 'utf8'), first.get(filename), `${filename}: nondeterministic`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('generated demo pages are not tracked, so Pages can only serve fresh CI builds', () => {
  const tracked = execFileSync('git', ['ls-files', '--', 'demo'], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(tracked.trim(), '');
});
