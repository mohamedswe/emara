import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AppShellPreset,
  renderFeatureMapAppShellHtml,
  type ViewerPayload,
} from "./renderFeatureMapHtml.ts";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const demoDir = resolve(projectRoot, "demo");

const TARGET_SPECS = [
  {
    id: "uptime-kuma",
    label: "louislam/uptime-kuma",
    subtitle: "85k★ · Self-hosted monitoring tool (Node + Express + Vue)",
    demoFilename: "uptime-kuma.html",
  },
  {
    id: "full-stack-fastapi-template",
    label: "fastapi/full-stack-fastapi-template",
    subtitle: "40k★ · Canonical FastAPI + React + SQLModel stack",
    demoFilename: "fastapi-template.html",
  },
  {
    id: "bulletproof-react",
    label: "alan2207/bulletproof-react",
    subtitle: "35k★ · Scalable React / Next.js feature architecture",
    demoFilename: "bulletproof-react.html",
  },
];

export async function buildStaticDemos(): Promise<void> {
  await mkdir(demoDir, { recursive: true });
  await writeFile(resolve(demoDir, ".nojekyll"), "");

  const famousRoot = resolve(tmpdir(), "emara-famous-repos");

  const presets: AppShellPreset[] = TARGET_SPECS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    subtitle: spec.subtitle,
    path: spec.id,
    url: spec.demoFilename,
  }));

  console.log("[buildStaticDemos] Building landing page demo/index.html…");
  const landingHtml = renderFeatureMapAppShellHtml({
    presets,
    initialPayload: null,
  });
  await writeFile(resolve(demoDir, "index.html"), landingHtml, "utf8");
  console.log(`[buildStaticDemos] demo/index.html written (${(landingHtml.length / 1024).toFixed(1)} KB)`);

  for (const spec of TARGET_SPECS) {
    const precomputedHtmlPath = resolve(
      famousRoot,
      spec.id,
      "audit-output",
      "feature-map.html",
    );

    if (!existsSync(precomputedHtmlPath)) {
      console.warn(`[buildStaticDemos] Warning: ${precomputedHtmlPath} not found, skipping.`);
      continue;
    }

    const htmlText = await readFile(precomputedHtmlPath, "utf8");
    const match = htmlText.match(
      /<script id="emara-boot" type="application\/json">([\s\S]*?)<\/script>/u,
    );

    if (!match?.[1]) {
      console.warn(`[buildStaticDemos] Warning: Could not find emara-boot script in ${precomputedHtmlPath}`);
      continue;
    }

    const parsedBoot = JSON.parse(
      match[1].replaceAll("</script>", "</script>"),
    ) as { initialPayload?: ViewerPayload };

    if (!parsedBoot.initialPayload) {
      console.warn(`[buildStaticDemos] Warning: No initialPayload in ${precomputedHtmlPath}`);
      continue;
    }

    const targetPayload: ViewerPayload = {
      ...parsedBoot.initialPayload,
      repositoryName: spec.label,
    };

    const renderedDemoHtml = renderFeatureMapAppShellHtml({
      initialPayload: targetPayload,
      presets,
    });

    const targetOutputPath = resolve(demoDir, spec.demoFilename);
    await writeFile(targetOutputPath, renderedDemoHtml, "utf8");
    console.log(
      `[buildStaticDemos] ${spec.label} -> demo/${spec.demoFilename} (${(
        renderedDemoHtml.length /
        (1024 * 1024)
      ).toFixed(2)} MB, ${targetPayload.featureMap.blocks.length} blocks)`,
    );
  }

  console.log("[buildStaticDemos] Complete! Ready for GitHub Pages deployment.");
}

const entryPath = process.argv[1];
if (entryPath !== undefined && entryPath.endsWith("buildStaticDemos.ts")) {
  buildStaticDemos().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
