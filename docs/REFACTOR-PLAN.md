# Refactor plan: large modules

Status: proposal only. Nothing below has been moved yet. Line ranges refer to commit `d452592` on `hardening/audit-fixes` and will drift. Regenerate them before starting (a simple column-0 declaration scan is enough).

Each step must be behavior-preserving. The acceptance check for every step is:

1. `npm run typecheck && npm test` pass.
2. Deterministic audits of `fixtures/frameworks/*`, the room-booking sample target (`9b40ef9`) and a frozen copy of this repository produce byte-identical `audit-report.md`, `functionality-audit.json`, `graph.json`, `feature-map.json`, `feature-map.html` and `semantic-passes.json` before and after. This byte-comparison is how the E1 refactor (`compareText` extraction) was accepted.

One module per pull request; do not combine moves with behavior changes.

## 1. `src/map/renderFeatureMapHtml.ts` (2,334 lines) — do this first

| Lines | Content | Notes |
| --- | --- | --- |
| 1–75 | Payload types, `buildViewerPayload`, `renderFeatureMapHtml` | Keep. |
| 76–2234 | `renderFeatureMapAppShellHtml`: one template literal | Contains everything below. |
| 105–1157 | `<style>` block, about 1,050 lines of CSS | No `${}` interpolation and no backticks. |
| 1159–1276 | `<body>` markup | Seven `${}` interpolations (title, static-demo switches, boot JSON). Keep in TS. |
| 1278–2224 | Viewer client `<script>`, about 950 lines of browser JS | No `${}` interpolation and no backticks. **Not type-checked today.** |
| 2235–2258 | `withContentSecurityPolicy` | Hashes the client script, so it must keep working on the extracted file's exact bytes. |
| 2259–2334 | Embedded node/source index builders, `escapeHtml` | Keep, or move with payload building. |

Proposed seams:

- **`src/map/viewer/client.js`** (top candidate). Move lines 1279–2223 verbatim. Add `// @ts-check` and JSDoc types, and a `src/map/viewer/tsconfig.json` (`allowJs`, `checkJs`, `lib: ["dom", "es2022"]`, `noEmit`) wired into `npm run typecheck`. This brings the browser code, which renders untrusted repository text through `innerHTML` with `esc()`, under the type checker for the first time. The renderer reads the file once at module load with `readFileSync(new URL("./viewer/client.js", import.meta.url))` and inlines it, so `feature-map.html` stays a single self-contained file and the CSP hash covers the same bytes. The Docker image already copies `src/`.
  - Watch-outs: the client reads `boot` from `#emara-boot` and touches many element IDs defined in the body markup. Add a test that every `getElementById("…")` in `client.js` exists in the rendered markup. Keep CRLF/LF normalization explicit, because the CSP hash is over exact bytes.
- **`src/map/viewer/styles.css`**: move lines 106–1156 the same way. Lower value, but it shrinks the TS file to about 300 lines.
- **`src/map/viewer/markup.ts`**: the body template (lines 1159–1276) as a function of `{ pageTitle, staticDemo, serializedBoot }`.

## 2. `src/audit/buildFunctionalityAudit.ts` (2,897 lines)

`buildFunctionalityAudit` (193–446) is the orchestrator; the rest are cohesive groups that only share types. Move the types (82–147) first into `src/audit/functionalityAuditTypes.ts`, then:

| Proposed module | Lines (functions) |
| --- | --- |
| `deterministicFeatures.ts` | 447–495 `buildDeterministicFeatures`, 796–946 `mergeFeatureSources` … `deterministicFeatureKind` |
| `claimEvidence.ts` | 496–792 (enumerated claims, evidence search, `isImplementationEvidenceFile`, `implementationNodeSearchText`) |
| `featureDecoration.ts` (model-facing) | 148–192 schema/instructions, 947–1517 (`buildDecorationFacts` … `applyFeatureDecoration`), 2481–2497 `timedModelRequest`, 2826–2842 `extractOutputText` |
| `documentationMapping.ts` | 1518–2070 (product-copy promises, source packets, external contracts, access-control enforcement, relevance filtering/recovery, route ownership) |
| `semanticDraft.ts` | 2071–2174 quality/selection/canonical identity, 2498–2814 `parseSemanticDraft` … `reconcileFinalCoverage` |
| `promiseReconciliation.ts` | 2175–2480 (contradicted/unsupported promises, matching, token helpers, IDs) |
| keep in place | 193–446 orchestrator, 2815–2897 small helpers (`deduplicateCandidates`, `parseCoverageLimitations`, …) |

`featureDecoration.ts` is the only part that talks to the model. Isolating it makes the "the model never decides membership or verdicts" boundary in `docs/architecture.md` checkable by import graph: no verdict-producing module may import it.

## 3. `src/parser/parseSourceFile.ts` (2,567 lines)

| Proposed module | Lines (functions) |
| --- | --- |
| `parser/jsParse.ts` | 32–264 constants, `parseSourceFile`, `parseJavaScriptSourceFile`, JSX-ampersand recovery, grammar selection |
| `parser/imports.ts` | 265–452 `extractImports`, 2340–2434 `requireBindings`, `commonJsExportTarget`, 2474–2499 `createImport` |
| `parser/exports.ts` | 453–584 `extractExports`, 2500–2525 `createExport`, 2110–2118, 2243–2272 |
| `parser/symbols.ts` | 585–638 `extractSymbols`, 2085–2242 symbol naming/binding helpers |
| `parser/calls.ts` | 639–763, 1892–2066 (call extraction, local binding resolution) |
| `parser/entrypoints.ts` | 764–984, 1086–1891 (framework routes, decorators, HTTP receivers, React DOM bootstrap, route objects) |
| `parser/eventsAndRenders.ts` | 985–1085 |
| `parser/treeUtils.ts` | 2067–2084 `extractDiagnostics`, 2463–2473, 2526–2567 (`walkNamed`, `toLineRange`, …) |

`entrypoints.ts` (about 1,000 lines) is the riskiest move, because many helpers are shared with `calls.ts`. Move `treeUtils.ts` first, then `imports`/`exports`, and leave `entrypoints` for last.

## Out of scope for these moves

- Behavior changes (for example the side-effect-import reachability question in `AUDIT-FIXES.md`).
- Renaming public CLI flags or output schemas.
