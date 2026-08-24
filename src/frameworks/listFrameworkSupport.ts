import { FRAMEWORK_PACKS } from "./catalog.ts";

console.log(JSON.stringify({
  supportLevels: {
    baseline: "language symbols/imports/calls/evidence",
    entrypoints: "baseline plus framework entrypoints and lifecycle conventions",
    semantic: "entrypoints plus framework-specific semantic graph relationships",
  },
  frameworks: FRAMEWORK_PACKS.map((pack) => ({
    id: pack.id,
    displayName: pack.displayName,
    family: pack.family,
    languages: pack.languages,
    support: pack.support,
    versionPolicy: pack.versionPolicy ?? "syntax-stable",
    packages: pack.detection.packageNames ?? [],
    notes: pack.notes ?? [],
  })),
}, null, 2));
