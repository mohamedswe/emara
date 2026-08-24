import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { RepositoryGraph } from "./types.js";
import { validateRepositoryGraph } from "./validateRepositoryGraph.ts";

export function serializeRepositoryGraph(graph: RepositoryGraph): string {
  validateRepositoryGraph(graph);
  return `${JSON.stringify(graph, null, 2)}\n`;
}

export async function readRepositoryGraph(inputPath: string): Promise<RepositoryGraph> {
  if (inputPath.length === 0) {
    throw new Error("Graph input path must not be empty");
  }
  const absoluteInputPath = resolve(inputPath);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(absoluteInputPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read repository graph: ${absoluteInputPath}`, {
      cause: error,
    });
  }
  validateRepositoryGraph(value);
  return value;
}

export async function writeRepositoryGraph(
  graph: RepositoryGraph,
  outputPath: string,
): Promise<string> {
  if (outputPath.length === 0) {
    throw new Error("Graph output path must not be empty");
  }

  const absoluteOutputPath = resolve(outputPath);
  const outputDirectory = dirname(absoluteOutputPath);
  const temporaryPath = join(
    outputDirectory,
    `.${basename(absoluteOutputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const serializedGraph = serializeRepositoryGraph(graph);

  await mkdir(outputDirectory, { recursive: true });

  try {
    await writeFile(temporaryPath, serializedGraph, "utf8");
    await rename(temporaryPath, absoluteOutputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  return absoluteOutputPath;
}
