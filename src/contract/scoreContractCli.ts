// Score an existing contract.yaml and print the Functionality grade.
//
// Usage:
//   node --experimental-strip-types src/contract/scoreContractCli.ts <contract.yaml> [--json]

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { scoreContract } from "./scoreContract.ts";
import type { SoftwareContract } from "./types.js";

function loadContract(path: string): SoftwareContract {
  return parseYaml(readFileSync(path, "utf8")) as SoftwareContract;
}

export async function runScoreCli(args: readonly string[]): Promise<void> {
  const asJson = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  const target = positional[0];
  if (target === undefined) {
    console.error("Usage: node --experimental-strip-types src/contract/scoreContractCli.ts <contract.yaml> [--json]");
    process.exit(1);
  }
  const contract = await loadContract(resolve(target));
  const result = scoreContract(contract);

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const line = "─".repeat(64);
  console.log(line);
  console.log(`FUNCTIONALITY  ${result.score}/100   (${result.grade})`);
  console.log(line);
  console.log(
    `  coverage ${pct(result.subscores.coverage)}   verification ${pct(result.subscores.verification)}   certainty ${pct(result.subscores.certainty)}   trust ${pct(result.subscores.trust)}`,
  );
  console.log("");
  console.log(
    `  ${result.basis.verifiedClaims}/${result.basis.totalClaims} claims verified · ${result.basis.coveragePercent}% coverage · ${result.basis.uncertainties} uncertainties · ${result.basis.contradictedClaims} contradicted`,
  );

  const pointDeductions = result.deductions.filter((d) => d.points > 0);
  if (pointDeductions.length > 0) {
    console.log("\nWHERE THE POINTS WENT");
    for (const d of pointDeductions) {
      console.log(`  -${d.points}  ${d.detail}`);
    }
  }

  if (result.suggestions.length > 0) {
    console.log("\nHOW TO RAISE IT");
    for (const s of result.suggestions) {
      console.log(`  +${s.pointsRecovered}  ${s.action}`);
    }
  }
  console.log(line);
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  resolve(entryPath) === resolve(fileURLToPath(import.meta.url))
) {
  runScoreCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
