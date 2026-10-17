import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const shim = fileURLToPath(new URL('../bin/auditor.mjs', import.meta.url));
const windowsReason = process.platform === 'win32' &&
  'Windows terminates the shim unconditionally on SIGINT/SIGTERM, so its forwarding listeners never run';

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`CLI shim exits by ${signal} (not 0) after forwarding it to the audit`, { skip: windowsReason }, async (context) => {
    const output = await mkdtemp(join(tmpdir(), 'emara-shim-signal-'));
    context.after(() => rm(output, { recursive: true, force: true }));
    // Auditing this repository takes long enough to interrupt mid-run.
    const child = spawn(process.execPath, [
      shim, root, '--deterministic',
      '--output', join(output, 'functionality-audit.json'),
      '--graph', join(output, 'graph.json'),
    ], { stdio: 'ignore' });
    const exited = new Promise((resolve) => child.on('exit', (code, received) => resolve({ code, signal: received })));
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    child.kill(signal);
    const result = await exited;
    assert.ok(
      result.signal === signal || (result.code !== null && result.code !== 0),
      `expected termination by ${signal}, got ${JSON.stringify(result)}`,
    );
  });
}
