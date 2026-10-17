#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(
  new URL("../src/audit/runFunctionalityAudit.ts", import.meta.url),
);
const child = spawn(
  process.execPath,
  ["--experimental-strip-types", cliPath, ...process.argv.slice(2)],
  { stdio: "inherit", windowsHide: true },
);

const forwarders = new Map();
for (const signal of ["SIGINT", "SIGTERM"]) {
  const forward = () => child.kill(signal);
  forwarders.set(signal, forward);
  process.on(signal, forward);
}

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal !== null) {
    // Re-raise so the caller sees the same signal. Our forwarders must be
    // removed first, or they would swallow it and the shim would exit 0.
    for (const [name, forward] of forwarders) process.off(name, forward);
    process.exitCode = 128 + (constants.signals[signal] ?? 0);
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
