import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { RepositoryGraph } from "../graph/types.js";
import type { SoftwareContract } from "./types.js";
import { validateSoftwareContract } from "./validateSoftwareContract.ts";

export function serializeSoftwareContract(
  contract: SoftwareContract,
  graph: RepositoryGraph,
): string {
  validateSoftwareContract(contract, graph);
  return `${serializeYamlValue(contract, 0)}\n`;
}

export async function writeSoftwareContract(
  contract: SoftwareContract,
  graph: RepositoryGraph,
  outputPath: string,
): Promise<string> {
  if (outputPath.length === 0) {
    throw new Error("Contract output path must not be empty");
  }

  const absoluteOutputPath = resolve(outputPath);
  const outputDirectory = dirname(absoluteOutputPath);
  const temporaryPath = join(
    outputDirectory,
    `.${basename(absoluteOutputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const serialized = serializeSoftwareContract(contract, graph);
  await mkdir(outputDirectory, { recursive: true });

  try {
    await writeFile(temporaryPath, serialized, "utf8");
    await rename(temporaryPath, absoluteOutputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  return absoluteOutputPath;
}

function serializeYamlValue(value: unknown, indent: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${" ".repeat(indent)}[]`;
    return value
      .map((item) => {
        if (isScalar(item)) {
          return `${" ".repeat(indent)}- ${serializeScalar(item)}`;
        }
        return [
          `${" ".repeat(indent)}-`,
          serializeYamlValue(item, indent + 2),
        ].join("\n");
      })
      .join("\n");
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${" ".repeat(indent)}{}`;
    return entries
      .map(([key, item]) => {
        const prefix = `${" ".repeat(indent)}${serializeKey(key)}:`;
        if (isScalar(item)) return `${prefix} ${serializeScalar(item)}`;
        if (Array.isArray(item) && item.length === 0) return `${prefix} []`;
        if (isRecord(item) && Object.keys(item).length === 0) return `${prefix} {}`;
        return `${prefix}\n${serializeYamlValue(item, indent + 2)}`;
      })
      .join("\n");
  }

  if (isScalar(value)) {
    return `${" ".repeat(indent)}${serializeScalar(value)}`;
  }

  throw new Error(`Unsupported contract YAML value: ${String(value)}`);
}

function serializeKey(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)
    ? value
    : JSON.stringify(value);
}

function serializeScalar(value: string | number | boolean | null): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  return String(value);
}

function isScalar(
  value: unknown,
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
