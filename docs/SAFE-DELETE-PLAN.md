# Emara Refinement Plan — Safe-Delete Loop (Phase 1)

Goal: `auditor <repo> --deterministic` should end with a **batch of candidates proven safe to delete**, with evidence — not just a list of `CANDIDATE` verdicts.

State verified 2026-10-14: 237/237 tests pass; oracles PASS on uptime-kuma (102 features / 89 dead candidates), AI-tutor (28/17), Rentyl (66/161). Baseline is green — this is refinement, not repair.

## Repo map

Everything lives in `C:\Users\mabde\Development\GitHub\software-auditor-desktop` (branch `release/fixes`, latest commit 827f9f6). Other copies: `emara-release` = published release (do not develop there), `emara-viz` = visualizer (Phase 2), `Development\Local\emara-demo` = demo workspace.

**Note before starting:** working tree has uncommitted changes: modified `README.md`, untracked `codie-target/`, `docs/samples/`, `outreach/`. Commit or stash the README first; leave the untracked dirs alone.

## Where everything is

### The core dead-code pipeline

| File | Lines | What it does |
|---|---|---|
| `src/dead-code/findDeadCodeCandidates.ts` | 128 | Reachability-based candidates (entry point: called from `buildFunctionalityAudit.ts:214` with `{ reachabilityLedger }`) |
| `src/dead-code/findMechanicalDeadCodeCandidates.ts` | 624 | Mechanical candidates (unused exports, etc.); called at `buildFunctionalityAudit.ts:223` |
| `src/dead-code/findUnusedImportCandidates.ts` | 145 | Unused-import candidates (`dead-import:` ids) |
| `src/dead-code/filterFrameworkWiringCandidates.ts` | 211 | Filters false positives (framework wiring) |
| `src/dead-code/validateDeadCodeCandidate.ts` | 325 | **The isolated validator — already built, not wired to CLI.** Key internals below. |
| `src/audit/types.ts` | 121 | Verdict ladder: `CANDIDATE` → `VALIDATION_REQUIRED` → `VALIDATED_SAFE_TO_DELETE` (lines 16–18); `DeadCodeCandidate`, `validation` field shape |

### The validator (`validateDeadCodeCandidate.ts`) — what exists

- `validateDeadCodeCandidate(graph, repositoryPath, candidate, commands)` — one candidate per call. Copies repo to a temp dir (excludes `.git`, `node_modules`, `dist`, `build`, etc. — see `EXCLUDED_COPY_DIRECTORIES`, top of file), deletes the candidate file, runs your `DeadCodeValidationCommand[]` (spawn, 120s default timeout, 4000-char output cap), re-indexes via `indexRepository`, compares `featureFingerprint()` (entrypoints + Leiden clusters + shared subsystems), then sets verdict `VALIDATED_SAFE_TO_DELETE` iff all commands passed AND fingerprint unchanged. Temp dir removed in `finally`.
- `assertWholeFileDeletionAllowed()` — hard guard: whole-file validation only for `disconnected_candidate` files where every owned symbol/entrypoint/entity is also disconnected.
- **Limitation 1:** only Python unused-import removal is implemented (`removePythonImportBinding`, ~line 190) — JS/TS import candidates throw.
- **Limitation 2:** command timeout is 120s hard (`DEFAULT_COMMAND_TIMEOUT_MS`) — too short for `npm install && npm test` on big repos; commands run in the copy which has **no node_modules**.
- **Limitation 3:** verdict result is returned in-memory; nothing persists it into `functionality-audit.json`.

### The audit pipeline

| File | What it does |
|---|---|
| `src/audit/runFunctionalityAudit.ts` (242 ln) | CLI entrypoint (`bin/auditor.mjs` → `npm run auditor`). Parses `--deterministic --output --graph --expected-commit --oracle --model`. Calls `indexRepository` → `buildFunctionalityAudit` → `renderAuditReportFromJson` → oracle check. **This is where `--safe-delete` wiring goes.** |
| `src/audit/buildFunctionalityAudit.ts` (2879 ln) | The audit builder. Dead-code candidates assembled around lines 214–228, merged (`filterInFileUsedMjsExportCandidates`) near line 2812, attached to the audit at line ~399 |
| `src/audit/renderAuditReport.ts` (164 ln) | Markdown report renderer |
| `src/audit/oracle.ts` (247 ln) | `evaluateAuditAgainstOracle(audit, oracleJson)` — the release gate |
| `src/audit/validateFunctionalityAudit.ts` (380 ln) | Structural validation of the audit JSON — **update this if you add validation fields to candidates** |

### Graph / features / reachability (read-only for this phase)

- `src/graph/indexRepository.ts` — indexing entry (re-run by validator on the mutated copy)
- `src/features/clusterRepositoryFeatures.ts` — Leiden clustering (seed 42); feeds `featureFingerprint`
- `src/retrieval/reachabilityLedger.ts` — reachability classes

### Tests (all co-located `*.test.mjs`, run via `npm test`, 237 currently)

- `src/dead-code/validateDeadCodeCandidate.test.mjs` — the validator's tests; extend for batch mode + JS import removal
- `src/audit/runFunctionalityAudit.test.mjs` — CLI-level tests; add `--safe-delete` coverage

### Oracles & benchmarks

- `bench/oracles/{uptime-kuma.v1,rentyl.v1,ai-tutor.v1,ai-tutor.v2}.json` — gold standards
- `bench/eval-oracle.mjs` — usage: `node --experimental-strip-types bench/eval-oracle.mjs <audit.json> <oracle.json>` (takes audit JSON first, oracle second)
- Test target repos on disk: `Development\GitHub\uptime-kuma`, `Development\GitHub\AI-tutor`, `Development\GitHub\Rentyl-LIVE`
- Full audit run: `node --experimental-strip-types src/audit/runFunctionalityAudit.ts "C:/Users/mabde/Development/GitHub/uptime-kuma" --deterministic` (always use `C:/` paths, not `/c/...` — the CLI shells out to git which doesn't understand MSYS paths)

## Implementation plan (4 increments)

### Increment 1 — Wire single-candidate validation into the CLI
1. Add `--validate-dead-code` + `--validation-command "<label>::<command>"` (repeatable) flags to `parseArguments` in `src/audit/runFunctionalityAudit.ts` and `CliOptions`.
2. After `buildFunctionalityAudit`, for each candidate with verdict `CANDIDATE`: call `validateDeadCodeCandidate`, merge the returned verdict/validation/blockers back into the audit's `deadCodeCandidates` array (dedup by candidate `id` — reuse the merge pattern at `buildFunctionalityAudit.ts:2812`).
3. Surface in `renderAuditReport.ts`: new report section "Validated safe to delete" with file + evidence (commands run, fingerprint unchanged).
4. Confirm `validateFunctionalityAudit.ts` accepts the new shape; extend it to *require* `validation` when verdict is `VALIDATED_SAFE_TO_DELETE`.
5. Tests: extend `runFunctionalityAudit.test.mjs` with a fixture repo + a trivially-passing command.

### Increment 2 — JS/TS unused-import removal
Port `removePythonImportBinding` logic to JS/TS: single-line `import { a, b } from './x'` and `import x from './y'` removal (match `findUnusedImportCandidates.ts` for what candidates look like). Same "exactly one simple import line" fail-closed contract. Extend `validateDeadCodeCandidate.test.mjs`.

### Increment 3 — Batch validation command
Add `validateDeadCodeCandidatesBatch(graph, repoPath, candidates, commands)` in a new `src/dead-code/validateDeadCodeCandidatesBatch.ts`: groups candidates per file, applies **cumulative** deletions in one temp copy (delete all batched files, re-index once, fingerprint once), re-validates individually any file whose batch fails — so one broken candidate doesn't demote the whole batch. Output: per-candidate results + a `safe-delete-batch.json` artifact (list of paths proven deletable together) written next to the other audit outputs in `<repo>/audit-output/`.

### Increment 4 — Validation environment fix
`EXCLUDED_COPY_DIRECTORIES` currently excludes `node_modules`, so validation commands can't build/test. Options (pick one, document the choice in the validator's docstring):
- (a) `npm ci --ignore-scripts` / `pip install -e .` inside the temp copy as an implicit first command (slow, correct);
- (b) junction/hardlink the original `node_modules` into the copy (fast, Windows-safe via `fs.cp` dereference off / `mklink /J`; risk: build tools that mutate node_modules);
- (c) allow the user to declare `--validation-exclude` overrides.
Raise `DEFAULT_COMMAND_TIMEOUT_MS` to a configurable `--validation-timeout` (default 600000).

## Definition of done (per Mohamed's standard — evidence, not claims)
1. `npm test` — all pass (237 + new).
2. `npm run typecheck` clean.
3. Full run on uptime-kuma with `--validate-dead-code` and real commands (e.g. `npm ci` + `npm test` on a subset) produces `safe-delete-batch.json` with a non-empty validated set and zero false promotions (spot-check ≥3 promoted candidates by deleting them in a scratch clone of uptime-kuma and running its test suite yourself).
4. Oracle gate unchanged: all three oracles still PASS with the feature/candidate counts identical (102/89, 66/161, 28/17).
5. Determinism: two identical runs produce identical `safe-delete-batch.json` (except labels).

## Phase 2 (after this lands)
Visualizer work happens in `Development\GitHub\emara-viz` (React map UI; last commit d897813, Aug 27: map overflow fixes). It should consume `graph.json` + `functionality-audit.json` + the new `safe-delete-batch.json` so the map shows reachability classes and validated-deletable files.
