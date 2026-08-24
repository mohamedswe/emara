import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";

import type { ScannedFile } from "../scanner/types.js";
import type { TypeScriptModuleResolutionConfig } from "./resolveInternalImports.ts";

export async function loadTypeScriptModuleResolutionConfigs(
  repositoryRoot: string,
  files: readonly ScannedFile[],
): Promise<TypeScriptModuleResolutionConfig[]> {
  const configPaths = files
    .map((file) => file.path)
    .filter((path) => /(?:^|\/)(?:tsconfig|jsconfig)\.json$/iu.test(path))
    .sort(compareText);

  const configs = await Promise.all(
    configPaths.map(async (path): Promise<TypeScriptModuleResolutionConfig | null> => {
      const absolutePath = join(repositoryRoot, ...path.split("/"));
      const value = parseJsonConfig(await readFile(absolutePath, "utf8"), path);
      const compilerOptions = recordValue(value.compilerOptions);
      const rawPaths = recordValue(compilerOptions.paths);
      const paths: Record<string, string[]> = {};
      for (const [pattern, substitutions] of Object.entries(rawPaths)) {
        if (!Array.isArray(substitutions)) continue;
        const strings = substitutions.filter(
          (entry): entry is string => typeof entry === "string" && entry.length > 0,
        );
        if (strings.length > 0) paths[pattern] = strings;
      }
      const configuredBaseUrl = compilerOptions.baseUrl;
      if (
        Object.keys(paths).length === 0 &&
        typeof configuredBaseUrl !== "string"
      ) {
        return null;
      }
      const directoryValue = posix.dirname(path);
      return {
        directory: directoryValue === "." ? "" : directoryValue,
        baseUrl:
          typeof configuredBaseUrl === "string" && configuredBaseUrl.length > 0
            ? configuredBaseUrl
            : ".",
        paths,
      };
    }),
  );

  return configs.filter(
    (config): config is TypeScriptModuleResolutionConfig => config !== null,
  );
}

function parseJsonConfig(text: string, path: string): Record<string, unknown> {
  try {
    const withoutComments = stripJsonComments(text);
    return recordValue(JSON.parse(stripTrailingCommas(withoutComments)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${path} for module resolution: ${message}`);
  }
}

function stripJsonComments(text: string): string {
  const output = [...text];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index];
    const next = output[index + 1];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "/" && next === "/") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 2;
      while (index < output.length && output[index] !== "\n" && output[index] !== "\r") {
        output[index] = " ";
        index += 1;
      }
      index -= 1;
      continue;
    }
    if (character === "/" && next === "*") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 2;
      while (index < output.length) {
        if (output[index] === "*" && output[index + 1] === "/") {
          output[index] = " ";
          output[index + 1] = " ";
          index += 1;
          break;
        }
        if (output[index] !== "\n" && output[index] !== "\r") output[index] = " ";
        index += 1;
      }
    }
  }
  return output.join("");
}

function stripTrailingCommas(text: string): string {
  const output = [...text];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character !== ",") continue;
    let nextIndex = index + 1;
    while (/\s/u.test(output[nextIndex] ?? "")) nextIndex += 1;
    if (output[nextIndex] === "}" || output[nextIndex] === "]") output[index] = " ";
  }
  return output.join("");
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
