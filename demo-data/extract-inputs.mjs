// Maintainer-only recovery tool. Reads committed HTML; never checks out or executes targets.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceCommit = '44f1e968deee9dcfe9e62fdb11062903465d11b8';
const specs = [
  ['uptime-kuma', 'uptime-kuma.html'],
  ['full-stack-fastapi-template', 'fastapi-template.html'],
  ['bulletproof-react', 'bulletproof-react.html'],
];
mkdirSync(new URL('../demo-data/', import.meta.url), { recursive: true });
const targets = specs.map(([id, filename]) => {
  const sourcePath = `demo/${filename}`;
  const html = execFileSync('git', ['show', `${sourceCommit}:${sourcePath}`], { cwd: root, encoding: 'utf8', maxBuffer: 20_000_000 });
  const marker = '<script id="emara-boot" type="application/json">';
  const start = html.indexOf(marker) + marker.length;
  if (start < marker.length) throw new Error(`Missing boot data: ${sourcePath}`);
  const { initialPayload } = JSON.parse(html.slice(start, html.indexOf('</script>', start)));
  if (!initialPayload?.featureMap?.repositoryCommit) throw new Error(`Missing pinned commit: ${sourcePath}`);
  const text = `${JSON.stringify(initialPayload)}\n`;
  const input = `${id}.json`;
  writeFileSync(new URL(`../demo-data/${input}`, import.meta.url), text);
  return { id, input, repository: initialPayload.repositoryName, repositoryCommit: initialPayload.featureMap.repositoryCommit, sourcePath, sha256: createHash('sha256').update(text).digest('hex') };
});
writeFileSync(new URL('../demo-data/manifest.json', import.meta.url), `${JSON.stringify({ schema: 'emara-demo-inputs/v1', sourceCommit, targets }, null, 2)}\n`);
console.log('Recovered pinned inputs without executing repository code.');
