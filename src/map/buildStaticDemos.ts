import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AppShellPreset,
  renderFeatureMapAppShellHtml,
  type ViewerPayload,
} from "./renderFeatureMapHtml.ts";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const MANIFEST_SCHEMA = "emara-demo-inputs/v1";
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

const TARGET_SPECS = [
  {
    id: "uptime-kuma",
    label: "louislam/uptime-kuma",
    subtitle: "Pinned snapshot · Self-hosted monitoring tool (Node + Express + Vue)",
    demoFilename: "uptime-kuma.html",
  },
  {
    id: "full-stack-fastapi-template",
    label: "fastapi/full-stack-fastapi-template",
    subtitle: "Pinned snapshot · FastAPI + React + SQLModel stack",
    demoFilename: "fastapi-template.html",
  },
  {
    id: "bulletproof-react",
    label: "alan2207/bulletproof-react",
    subtitle: "Pinned snapshot · React / Next.js feature architecture",
    demoFilename: "bulletproof-react.html",
  },
];

export interface BuildStaticDemosOptions {
  inputDir?: string;
  outputDir?: string;
}

interface DemoInputPin {
  id: string;
  input: string;
  repository: string;
  repositoryCommit: string;
  sourcePath: string;
  sha256: string;
}

/**
 * Renders the public demo pages from SHA-256-pinned viewer payloads in
 * `demo-data/`. Inputs are data only; nothing is fetched, checked out, or
 * executed. Every input is validated before any output is written.
 */
export async function buildStaticDemos(
  options: BuildStaticDemosOptions = {},
): Promise<void> {
  const inputDir = options.inputDir ?? resolve(projectRoot, "demo-data");
  const outputDir = options.outputDir ?? resolve(projectRoot, "demo");
  const pins = parseManifest(
    await readFile(resolve(inputDir, "manifest.json"), "utf8"),
  );

  const payloads: ViewerPayload[] = [];
  for (const spec of TARGET_SPECS) {
    const pin = pins.find((candidate) => candidate.id === spec.id);
    const text = await readFile(resolve(inputDir, `${spec.id}.json`), "utf8");
    try {
      if (
        pin === undefined ||
        pin.input !== `${spec.id}.json` ||
        pin.repository !== spec.label ||
        pin.sourcePath !== `demo/${spec.demoFilename}` ||
        createHash("sha256").update(text).digest("hex") !== pin.sha256
      ) {
        throw new Error("Pin does not match input bytes or target");
      }
      payloads.push(parsePayload(text, spec.label, pin.repositoryCommit));
    } catch (error) {
      throw new Error(`Invalid demo input ${spec.id}`, { cause: error });
    }
  }

  const presets: AppShellPreset[] = TARGET_SPECS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    subtitle: spec.subtitle,
    path: spec.id,
    url: spec.demoFilename,
  }));
  const pages: Array<[string, string]> = [
    ["index.html", renderFeatureMapAppShellHtml({ presets, initialPayload: null })],
  ];
  TARGET_SPECS.forEach((spec, index) => {
    const initialPayload = payloads[index];
    if (initialPayload === undefined) throw new Error(`Missing payload for ${spec.id}`);
    pages.push([spec.demoFilename, renderFeatureMapAppShellHtml({ presets, initialPayload })]);
  });

  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, ".nojekyll"), "");
  for (const [filename, html] of pages) {
    await writeFile(resolve(outputDir, filename), html, "utf8");
  }
  console.log(`[buildStaticDemos] Built ${pages.length} pages from pinned inputs in ${inputDir}.`);
}

function parseManifest(text: string): DemoInputPin[] {
  const manifest: unknown = JSON.parse(text);
  if (
    !isRecord(manifest) ||
    manifest.schema !== MANIFEST_SCHEMA ||
    typeof manifest.sourceCommit !== "string" ||
    !COMMIT_PATTERN.test(manifest.sourceCommit) ||
    !Array.isArray(manifest.targets) ||
    manifest.targets.length !== TARGET_SPECS.length
  ) {
    throw new Error("Invalid demo input manifest");
  }
  return manifest.targets.map((target: unknown) => {
    if (
      !isRecord(target) ||
      typeof target.id !== "string" ||
      typeof target.input !== "string" ||
      typeof target.repository !== "string" ||
      typeof target.repositoryCommit !== "string" ||
      !COMMIT_PATTERN.test(target.repositoryCommit) ||
      typeof target.sourcePath !== "string" ||
      typeof target.sha256 !== "string"
    ) {
      throw new Error("Invalid demo input manifest target");
    }
    return {
      id: target.id,
      input: target.input,
      repository: target.repository,
      repositoryCommit: target.repositoryCommit,
      sourcePath: target.sourcePath,
      sha256: target.sha256,
    };
  });
}

function parsePayload(
  text: string,
  repositoryName: string,
  repositoryCommit: string,
): ViewerPayload {
  const payload: unknown = JSON.parse(text);
  if (
    !isRecord(payload) ||
    payload.repositoryName !== repositoryName ||
    !isRecord(payload.featureMap) ||
    payload.featureMap.schema !== "feature-map/v1" ||
    payload.featureMap.repositoryCommit !== repositoryCommit ||
    !Array.isArray(payload.featureMap.blocks) ||
    payload.featureMap.blocks.length === 0 ||
    !Array.isArray(payload.featureMap.connections) ||
    !isRecord(payload.nodes) ||
    !isRecord(payload.sources)
  ) {
    throw new Error("Payload shape or provenance mismatch");
  }
  // Shape checked above; deeper fields are rendered as escaped JSON data only.
  return payload as unknown as ViewerPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && entryPath.endsWith("buildStaticDemos.ts")) {
  buildStaticDemos().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
