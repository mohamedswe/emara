import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const image = process.argv[2] ?? 'emara:hardening-check';
const root = mkdtempSync(join(tmpdir(), 'emara-container-smoke-'));
const repo = join(root, 'repo');
const output = join(root, 'output');
mkdirSync(repo); mkdirSync(output);
writeFileSync(join(repo, 'app.js'), 'function health() { return true; }\napp.get("/health", health);\n');
const run = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000 });
try {
  // Initialize as root in the container: exercising root-owned bind mounts is
  // intentional, because the audit itself must still run as the unprivileged user.
  run(['run', '--rm', '--user', '0:0', '--entrypoint', 'sh', '-v', `${repo}:/repo`, image, '-c', 'git -C /repo init -q && git -C /repo add . && git -C /repo -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm fixture']);
  const uid = run(['run', '--rm', '--entrypoint', 'id', image, '-u']).trim();
  assert.notEqual(uid, '0');
  run(['run', '--rm', '--entrypoint', 'node', image, '-e', 'const fs=require("fs");fs.writeFileSync("/output/probe","ok");try{fs.writeFileSync("/app/probe","bad");process.exitCode=1}catch(e){if(e.code!=="EACCES"&&e.code!=="EROFS"&&e.code!=="EPERM")throw e}']);
  // A Linux bind mount must explicitly permit the selected uid to write output.
  run(['run', '--rm', '--user', '0:0', '--entrypoint', 'chmod', '-v', `${output}:/output`, image, '0777', '/output']);
  const stdout = run(['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-v', `${repo}:/repo:ro`, '-v', `${output}:/output`, image, '/repo']);
  assert.match(stdout, /modelRequests=0/u);
  const audit = JSON.parse(readFileSync(join(output, 'emara-output', 'functionality-audit.json'), 'utf8'));
  assert.ok(audit);
  assert.ok(readFileSync(join(output, 'emara-output', 'audit-report.md'), 'utf8').length > 0);
  console.log(`Container smoke PASS: uid=${uid}, root-owned read-only target, network disabled, read-only root filesystem, writable reports, zero model requests.`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
