# Deterministic evidence architecture

Software Auditor separates facts that can be reproduced from language-model decoration. The deterministic pipeline owns the repository graph, source integrity, reachability, feature membership, documentation reconciliation, and every verdict. Optional model output can improve names; it cannot move the evidence boundary.

## Graph v4

The scanner computes a SHA-256 content hash and line count for every supported source file. Language frontends then emit normalized file, symbol, entrypoint, endpoint, component, screen, schema, configuration, test, and event nodes. Structural and semantic relationships carry their own file-and-line evidence and identify whether the scanner, parser, or resolver extracted the fact.

Graph v4 stores parser coverage and diagnostics with the graph, so an unparsed file or unresolved framework registration cannot disappear from later validation. Source retrieval resolves paths inside the repository, enforces line and byte limits, rereads the file, and compares its current SHA-256 hash with the indexed hash. A mismatch fails closed instead of returning stale evidence.

```text
repository
  -> scanner and language frontends
  -> evidence graph v4
  -> reachability ledger
  -> entrypoint slices and structural communities
  -> deterministic feature inventory and verdicts
  -> optional label decoration
  -> validated report and oracle result
```

## Entrypoint slices and Leiden clustering

External entrypoints seed weighted implementation slices. Traversal follows evidence-bearing call, reference, handler, validation, render, event, test, and configuration relationships. Scores decay across each path, membership is thresholded deterministically, and legitimate overlap is retained. Shared modules remain visible as shared subsystems rather than being assigned arbitrarily to one feature.

Repositories without enough external entrypoints still receive structural coverage. Symbols and other evidence nodes are collapsed to their owning files, and a weighted file graph is partitioned with Leiden modularity using the fixed random seed `42`. Isolated files are attached by module directory. The entrypoint and structural views are then reconciled, with explicit disagreement records where both contain useful evidence.

Feature `canonicalId` values are SHA-256-derived from sorted entrypoint and implementation membership. Human-readable wording is not an input, so relabeling cannot change feature identity.

## Reachability classes

The reachability ledger records the strongest justified liveness class, its evidence paths, confidence, and any blockers for every owned node and file.

| Class | Meaning |
| --- | --- |
| `product_reachable` | A proven path exists from recognized external behavior. |
| `startup_reachable` | A proven path exists from an internal startup root. |
| `test_only` | The node is reached only through established test conventions. |
| `public_api_unproven` | An exported symbol may be a library API where no external entrypoint is recognized. |
| `dynamic_unknown` | Static evidence is incomplete because of diagnostics or unresolved production relationships. |
| `disconnected_candidate` | No runtime, startup, test, or meaningful relationship path was found; deletion still requires validation. |

Reachability constrains feature membership. Disconnected candidates and unproven public APIs cannot be presented as reachable implementation evidence. Dead-code output follows a fail-closed ladder from `CANDIDATE` to `VALIDATION_REQUIRED`; only isolated build/test checks with an unchanged feature fingerprint can produce `VALIDATED_SAFE_TO_DELETE`.

## Evidence boundary

The deterministic pipeline extracts documentation promises, entrypoints, source evidence, feature memberships, status inputs, and dead-code candidates before any model request. Documentation-only claims stay quarantined when there is no deterministic feature match.

In assisted mode, the only model backend is DeepSeek. It receives a locked inventory and may propose human-readable feature titles plus bounded promise mappings. It cannot add, remove, split, merge, or reclassify features, and it never returns verdict-bearing fields. Suggested mappings are accepted only when independent deterministic relevance checks agree. The audit uses at most two requests; invalid, incomplete, or lower-quality output is rejected, and deterministic labels remain available as a complete fallback. `--deterministic` skips the model entirely.

## Oracle-gated releases

Files in `bench/oracles/` pin a repository commit and encode independently reviewed expectations: recognized entrypoint counts, minimum documentation coverage, required feature and dead-code findings, forbidden documentation mappings, runtime budgets, and the maximum model-request count. An oracle run fails when any required fact is absent, misclassified, too slow, or over budget.

Release verification combines these gold-standard oracles with repeated-run determinism checks. Across identical repository snapshots, feature membership, status, canonical identity, and dead-code candidates must remain identical; only optional human-readable labels may vary. This keeps regression detection outside the model and makes a passing report reproducible.
