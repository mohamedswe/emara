import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Inspect only Git-tracked files, not generated output or local fixtures.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);
const marker = /^(?:<{7}|>{7}|\|{7})(?: .*)?$/u;
let conflicts = 0;
for (const file of files) {
  let content;
  try {
    content = readFileSync(file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') continue;
    throw error;
  }
  if (content.includes(0)) continue;
  content.toString('utf8').split(/\r?\n/u).forEach((line, index) => {
    // A standalone equals underline is also legitimate Markdown. Conflict
    // blocks are caught by their opening/closing (or diff3 ancestor) lines.
    if (marker.test(line)) {
      console.error(`${file}:${index + 1}: unresolved merge conflict marker`);
      conflicts += 1;
    }
  });
}
if (conflicts > 0) process.exitCode = 1;
