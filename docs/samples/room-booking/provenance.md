# Run provenance

Generated and checked at 2026-09-09T00:46:32.752988+00:00.

- Target: https://github.com/julia-/room-booking-system
- Target commit: `9b40ef983d38a8b5862c629e860693cfd98108f7` (clean detached checkout before audit).
- Engine commit: `827f9f6d9bb6be12b68a9fd0f29f30e87bc142e7`. No engine source edits in this preparation.
- Execution: local source CLI, deterministic mode. Target application dependencies were not installed and target application code was not executed.
- Result: exit 0; 77 graph files, 123 symbols, 11 entrypoints, 22 feature entries, 36 dead-code candidates, 0 model requests, 0 tokens.
- Runtime: not independently measured. Ignore the engine's zero timing fields.
- No oracle or full product regression suite was run for this sample. Selected findings were reviewed against source, as described in the walkthrough.I 
- `audit-report.md` is copied byte-for-byte from the fresh run. The walkthrough is separately authored human-review material, not generated engine output.

## Reproduce

With Node.js 22.6+ and Git, clone Emara and install its dependencies. From its checkout:

```sh
git checkout 827f9f6d9bb6be12b68a9fd0f29f30e87bc142e7
npm ci
git clone https://github.com/julia-/room-booking-system.git ../room-booking-system
git -C ../room-booking-system checkout --detach 9b40ef983d38a8b5862c629e860693cfd98108f7
npm run auditor -- ../room-booking-system --deterministic --expected-commit 9b40ef983d38a8b5862c629e860693cfd98108f7 --output ../sample-output/functionality-audit.json --graph ../sample-output/graph.json
```

The actual run used absolute Windows paths for the same arguments. The raw JSON artifacts remain local; their hashes below identify this run, not a cross-machine byte-equivalence guarantee.

## SHA-256 artifact hashes

- `audit-report.md`: `1aedd359bb931e84d3e7ad197c57e3c07daae035f49f7a0048dd7662500263cc`
- `functionality-audit.json`: `54f8628770146e600f21e32d340981c657e06d692edcbcf607e0f2c96e43d327`
- `graph.json`: `5fe5a0c58add410421e9ea8a4c797e4aa898814e8df2a241a5a3c233d52288f2`
- `semantic-passes.json`: `2f4edd4e2e4cae3f35c8a201bbab818a2cd31b4ad889428b92549b921822511a`
