# Audit fixes: hardening pass on `hardening/audit-fixes`

Base: `44f1e96` (the reviewed commit). Branch: `hardening/audit-fixes`, 21 commits plus this file. Nothing was pushed, published or deployed.

## Starting state and decisions

- The `release/fixes` working tree held about 760 lines of **uncommitted** work on top of `44f1e96` that already attempted many findings. As decided, it was treated as a set of hypotheses. It was stashed (`stash@{0}`, "WIP audit fixes (pre-hardening backup)", still present) and re-applied finding by finding, with each change re-verified. Parts were rejected; see "Rejected" below.
- Decisions taken by the owner during this pass:
  - D2: relative paths resolve against the caller's directory; default output is `./emara-output`.
  - A1: `demo/*.html` is untracked and built in CI.
  - A3: on Windows, validation runs with best-effort `taskkill /T /F` plus a warning, rather than being refused.

### Baseline

| Check | `44f1e96` (clean worktree) | Uncommitted WIP | Final tip |
| --- | --- | --- | --- |
| `npm ci` | pass | pass | pass (fresh worktree) |
| `npm run typecheck` | pass | pass | pass |
| `npm test` | 275 tests: 274 pass, 0 fail, 1 skip | 303: 296 pass, **7 fail** | 316: 311 pass, 0 fail, 5 skip |
| `node scripts/check-conflict-markers.mjs` | pass | pass | pass |

Final skips: the POSIX process-group test, two symlink tests (symlink creation needs Developer Mode on Windows), and the two shim signal tests (Windows cannot exercise them). The pre-existing room-booking-artifacts skip also appears in a fresh worktree. All five new skips run on the Ubuntu CI matrix. Machine: Windows 11, Node 22.16.0. Node 24 was not available locally.

## Findings

| ID | Verified | Evidence | What changed | Tests added | Commit |
| --- | --- | --- | --- | --- | --- |
| A1 | Yes | Committed demos held 3,611 / 1,851 / 10,388 raw `<` in `#emara-boot`, and `uptime-kuma.html` had 165 legacy `<\/script` escapes. `buildStaticDemos` read inputs from `%TEMP%`, so CI could not rebuild. The workflow deployed ungated from `main` and `release/fixes`. | Pinned inputs in `demo-data/` (SHA-256 manifest, byte-identical to the 44f1e96 payloads); typed fail-closed builder; `demo/` untracked and gitignored; Pages runs on `main` only, after the reusable CI, and rebuilds `demo/`. | `test/static-demos.test.mjs`; ci-config Pages test; adversarial `</ScRiPt ><!--<script>` renderer case | `bab1bed` |
| A2 | Partly | No `USER` in the runtime image. **The image was not built or run**: the Docker engine was unavailable (see Open). | `USER node`, `/output` owned by node; `/app` stays root-owned. README documents `--user "$(id -u):$(id -g)"`. | ci-config Dockerfile test | `5b1ab57` |
| A3a | Yes (Windows); POSIX not run locally | Before the fix, a timed-out command's sleeping grandchild survived (reproduced on Windows). | POSIX: detached process group, SIGKILL the group on timeout and on exit. Windows: `taskkill /T /F` plus a one-time warning. Timeout exit code is 124. | Grandchild-after-timeout (all platforms); descendant-after-exit (POSIX only) | `04cde57` |
| A3b | Yes | A missing validator executable left the candidate `CANDIDATE` with no output. | `IneligibleCandidateError` for structural ineligibility only; other errors set `VALIDATION_REQUIRED`, add a blocker, and log to stderr. | CLI missing-executable test; typed-error test | `c86f11b` |
| A3c | Yes, by Node source; escape case tested on Windows | `fs.cp` defaults to `verbatimSymlinks: false`, which rewrites relative link targets to absolute paths **into the original repo**. On POSIX even `lib -> src` writes through. On Windows `cp` hits EPERM on links. | `verbatimSymlinks: true`; refuse links with absolute targets or targets outside the repo. | Escaping link refused (fails before); in-repo link write-through test (POSIX/Developer Mode) | `eff820e` |
| A4 | Partly | An oversized body got 413 but the connection stayed open (raw socket, CL 10 MB). Host/Origin/token/content-type checks were already correct (rebinding Host → 421; cross-origin `text/plain` → 415; foreign or `null` Origin with token → 403). | Stop reading, `Connection: close`, `req.destroy()` after the response; abort handling. | Oversized upload closed within 2 s; CSRF/opaque-origin regression test | `ca1198e` |
| B1 | Yes | Fixture `app.js → a.js` (syntax error) `→ b.js`: `b.js` was `disconnected_candidate`, listed as "ready to validate", and the report did not mention unparsed files. With `--validate-dead-code` it could become `VALIDATED_SAFE_TO_DELETE`. | Recovered imports (outside diagnostic ranges) and string/Python-import mentions stored as `graph.analysis.partialImports` (not edges). The ledger marks consumed files `dynamic_unknown`; the report adds a limitation with the unparsed count. | JS and Python fixtures; field absent when everything parses; validator; CLI/report e2e | `ecdb011` |
| B2 | Partly | The one-space replacement does shift UTF-16 offsets, but both call sites apply positions only to the sanitized text, so **no current output was wrong**. | One shared helper using two spaces. | Offset test plus a tree-sitter position test (fail with one space) | `c95706a` |
| B3 | Yes (several drifts) | Claims checked against code (list in `a39b7e3`). Wrong: star counts; demos implied live analysis; `npm run serve` network cloning and preset availability undocumented; the viewer said "Safely deletes" / "Unused / Safe Delete"; architecture said only supported files are hashed; `.gitignore` text. | README, architecture.md, new SECURITY.md; viewer wording; static demos disable analysis. Sample **not regenerated** (see Rejected). | Viewer wording and static-demo tests | `896aeaf`, `a39b7e3` |
| C1 | Yes | `getSource` re-validated the whole graph per call: 8.6 ms per validation on this repo's 4,989-file graph, about 1.6 s per sweep. | One lazy `createSourceReader` per sweep at all 4 sites. | Validation-count tests (N → 1, or 2 for discovery tools) | `3ac72cc` |
| C2 | Partly (2 sub-items rejected) | Sources were read twice and hashed three times; the unbounded `Promise.all` was in `indexRepository`, not the walk; a per-byte newline loop; no `.gitignore` support (4,798 of 4,990 files on this repo were ignored files). | `git ls-files --cached --others --exclude-standard`, with walk fallback for non-Git folders, submodule dirs and an empty listing; one read per source; 32-wide pool; `Buffer.indexOf`. | gitignore/tracked/untracked/.env; submodule; ignored-root fallback; symlink; line counts; 400 files | `f9e70a3` |
| C3 | Yes | 4 baseline-graph analyses per candidate (counter). | `prepareDeadCodeValidationBaseline` once per run; optional 5th argument. | Zero baseline reads across 2 candidates; tampered/foreign baseline | `092e79a` |
| D1 | By code reading; POSIX test not run locally | The re-raised signal was caught by the shim's own listener, so the exit was 0 on POSIX. Windows terminates unconditionally. | Remove only the shim's forwarders, set 128+N, then re-raise. | Real-process SIGINT/SIGTERM test (skipped on Windows) | `dfc8cf3` |
| D2 | Yes | Relative paths resolved against the Emara checkout; default output was `<target>/audit-output`. | Caller's directory (npm `INIT_CWD` for the package's own audit scripts only); default `./emara-output`; Docker `WORKDIR /output`. E2E: `npm run --prefix` from a scratch dir wrote there. | Default, relative flags, npm `INIT_CWD` | `abbe9bb` |
| D3 | Yes | No `engines` field. | `>=22.6` in package.json and the lockfile root. | ci-config consistency test | `62640b4` |
| E1 | Yes | 39 copies, mechanically checked identical, none exported. | `src/shared/compare.ts`; aliased imports. | None. Byte-identical audit outputs on 8 targets before and after. | `d452592` |
| E2 | n/a | Client script 1278–2224 has no `${}` or backticks (checked). | `docs/REFACTOR-PLAN.md` | — | `bcfcfce` |

### Output-format and user-visible changes (all intentional)

- `graph.json`: optional `analysis.partialImports`, present only when an unparsed file yields evidence. Graphs without unparsed files are unchanged.
- `functionality-audit.json`: one extra `limitations` entry when files are unparsed. Candidates that only unparsed files consume move from `disconnected_candidate`/`VALIDATION_REQUIRED` to `dynamic_unknown`/`UNKNOWN_DYNAMIC_USAGE`.
- File selection in Git work trees follows `.gitignore` (graphs for the six fixtures and a non-Git copy are byte-identical; on this repo only ignored paths dropped).
- CLI path resolution and default output directory (D2). Validation timeouts report exit code 124.
- Viewer HTML: CSP and `no-referrer` meta tags, no Google Fonts, deletion wording, disabled analysis on static demos.
- `demo/` is no longer tracked.

## Rejected (with reasons)

- **C2: "skip line counting for unknown languages" and "don't hash binaries".** `lineCount` becomes `FileNode.lineRange` for every file, and `getSource` refuses files without one (for example `get_source` on `Dockerfile`). `contentHash` is required. Both changes would alter `graph.json` and break retrieval; counting via `indexOf` is cheap.
- **C2 premise "unbounded `Promise.all` over file reads" in the scanner.** The walk was sequential; the unbounded `Promise.all` was in `indexRepository.parseScannedSourceFiles` and was removed there.
- **B3: regenerate `docs/samples/room-booking`.** It is a provenance record of engine `827f9f6` with published artifact hashes and a human-reviewed walkthrough. The current engine reproduces its counts exactly (77 files, 123 symbols, 11 entrypoints, 22 features, 36 candidates, `DELETE /rooms/:id/:bookingId` at `api/routes/rooms.js:154`). The only report difference is the later-added empty "Validated safe to delete" section.
- **From the uncommitted WIP:**
  - Refusing all validation commands on Windows: the owner chose best-effort instead.
  - Downgrading *every* candidate to `dynamic_unknown` when any file anywhere has a parse error: too broad; replaced by targeted evidence.
  - Hashing `JSON.stringify(graph)` on every validate call: it reintroduces the per-candidate full-graph cost that C3 removes.
  - Also considered and not adopted: refusing dead-import validation whenever any file is unparsed, and failing validation when commands create new parse errors. Both are rare edge cases; they are listed under Open.

## New issues found (not in the review)

| ID | Issue | Status |
| --- | --- | --- |
| N1 | Viewer pages loaded Google Fonts (a third-party request while viewing private source) and had no CSP. | Fixed `94d95e5`. Verified in headless Chrome: pages render; a tampered hash blocks the script. |
| N2 | `fs.cp` relative-symlink rewriting into the original repository (detail of A3c). | Fixed `eff820e` |
| N3 | Static demos showed an "Analyze Commit" form that POSTs to a backend GitHub Pages does not have. | Fixed `896aeaf` |
| N4 | Viewer presented static file exclusivity as "Safely deletes N files". | Fixed `896aeaf` |
| N5 | `decorateFeatureMapTitles` swallowed model failures in a comment-only `catch {}`. | Fixed `84e0c8c` |
| N6 | `npm run` executes from the package root, so "relative to cwd" alone would not have changed behavior for README users. | Handled in D2 via `INIT_CWD` |
| N7 | **A file reachable only through a side-effect import (`import "./b.js"`) is classified `disconnected_candidate`**, although deleting it breaks the importer. | **Open** (design decision) |
| N8 | `docs/SAFE-DELETE-PLAN.md` is a stale internal plan containing a local Windows path (`C:\Users\…`) and internal workspace names. | **Open** (owner decision) |
| N9 | The `npm run serve` fast path reads `<repo>/audit-output/feature-map.html`; since D2 the CLI no longer writes there by default, so that path is rarely hit (it falls back to indexing; output is unchanged). | Open, low |

## Open items

| Item | Risk | Recommended next step |
| --- | --- | --- |
| `docker build .` and the non-root/read-only container run were **not executed**. The Docker Desktop engine returned HTTP 500; after a restart and `wsl --shutdown` (approved), WSL remained hung (10 `wsl.exe` clients, `WSLService` unresponsive). | High until run | Reboot or restart WSLService, then run the commands in "Reproduce" (container section). `scripts/smoke-container.mjs` also runs in the publish workflow before any push. |
| POSIX-only tests not run locally: A3a process-group, A3c in-repo symlink, C2 tracked symlink, D1 shim signals. | Medium | Push the branch (owner action) and confirm the Ubuntu CI matrix (Node 22 and 24) is green. |
| Windows validation containment is best-effort: descendants of an exited parent can survive `taskkill /T`. | Medium (documented in SECURITY.md) | A Job Object helper (native addon or a small signed helper binary) if Windows validation must be trusted. |
| N7 side-effect-import reachability. | Medium (false deletion candidates) | Treat an incoming non-test IMPORTS edge as blocking whole-file deletion (file `dynamic_unknown`) while keeping symbol-level findings. Needs a decision on semantics. |
| Dead-import validation when other files are unparsed; validation commands that leave new parse errors. | Low | Fail closed if the mutated graph has unparsed files not present in the baseline. |
| Node 24 not run locally; the 22.6.0 minimum is not exercised anywhere. | Low | Covered by CI for 24.x; add 22.6.0 to the CI matrix if the minimum matters. |
| N8 stale SAFE-DELETE-PLAN.md with a local path. | Low | Remove the path or the file (owner decision). |
| Housekeeping: `stash@{0}` (WIP backup) is still present; a visualizer server (PID 45156, started 19:26, not by this pass) is still running from this checkout. Scratch worktrees used for verification were removed. | — | `git stash drop` once satisfied. |

## Reproduce the verification

```sh
git switch hardening/audit-fixes
npm ci && npm run typecheck && npm test && node scripts/check-conflict-markers.mjs

# Demos: rebuild; the test asserts no raw < in any JSON script block
npm run build:demos
node --experimental-strip-types --test test/static-demos.test.mjs src/map/renderFeatureMapHtml.test.mjs

# End-to-end deterministic audit, output outside the target, run twice
for run in 1 2; do
  for t in fixtures/frameworks/next-app fixtures/frameworks/fastapi-app .; do
    npm run -s auditor -- "$t" --deterministic --output "/tmp/emara-check/$run/$(basename "$(realpath "$t")")/functionality-audit.json" --graph "/tmp/emara-check/$run/$(basename "$(realpath "$t")")/graph.json"
  done
done
diff -r /tmp/emara-check/1 /tmp/emara-check/2 && echo "byte-identical"

# Container (not run in this pass; see Open)
docker build -t emara:check .
docker run --rm --entrypoint id emara:check -u        # expect 1000
node scripts/smoke-container.mjs emara:check          # non-root, read-only fixture, --network none

# Leftovers
grep -rnE "catch\s*(\([^)]*\))?\s*\{\s*\}" src bin scripts test
git diff 44f1e96..HEAD -U0 -- src bin scripts test | grep -E "^\+" | grep -E "TODO|FIXME|debugger"
```

What was actually run in this pass on Windows/Node 22.16.0:
- The gate above, in a fresh worktree.
- Deterministic audits, twice each, of all six `fixtures/frameworks/*`, the room-booking sample target at `9b40ef9`, and a frozen worktree of this branch. All six artifacts (`audit-report.md`, `functionality-audit.json`, `graph.json`, `feature-map.json`, `feature-map.html`, `semantic-passes.json`) were present, byte-identical across runs, with 0 raw `<` in every boot block and `modelRequests=0`. The target worktree was unmodified afterwards.
- The leftover sweep: no empty `catch {}` blocks remain in `src`, `bin`, `scripts` or `test` (the last two were fixed in `84e0c8c`), and no TODO/FIXME/debugger lines were added. The new `console.log` lines are intentional output: the smoke-test result, PIDs printed by test child processes, and the demo builder's status line.
