# Software Auditor

Software Auditor is a deterministic codebase auditor that turns source code and product documentation into an evidence-backed functionality report: every claim carries a file path, line range, and content hash; an optional bounded language-model pass may improve labels, but the graph, feature membership, and verdicts remain deterministic, and `--deterministic` runs fully offline with zero model requests.

## Quickstart

Run the published container against a Git repository mounted at `/repo`:

```sh
docker run --rm -v <repo>:/repo ghcr.io/mohamedswe/emara:latest /repo
```

Without `DEEPSEEK_API_KEY`, the container automatically enables deterministic mode. It writes `functionality-audit.json`, `graph.json`, `audit-report.md`, and `semantic-passes.json` under `<repo>/audit-output/`.

To run from source with npm, install Node.js 22.6 or newer and Git:

```sh
git clone https://github.com/mohamedswe/emara.git
cd emara
npm ci
npm run auditor -- <repo> --deterministic
```

An audit prints its evidence boundary and artifact locations as it runs. This abbreviated example uses a verified benchmark result:

```text
[functionality] mode=deterministic
[functionality] indexing and clustering deterministically
[functionality] graph files=... symbols=... entrypoints=...
[functionality] features=102 promises=... declaredClaims=... deadCandidates=89
[functionality] wallClock=... deterministic=... modelRequests=0 tokens=0
[functionality] audit=<repo>/audit-output/functionality-audit.json
[functionality] report=<repo>/audit-output/audit-report.md
```

The generated Markdown report starts with an independently derived summary:

```text
# Functionality Audit Report

Repository commit: `<sha>`

## Summary

| Result | Count |
| --- | ---: |
| Total features | 102 |
| Dead-code candidates | 89 |
```

## What it finds

- Features classified as implemented and documented, implemented but undocumented, partially implemented, documented but not implemented (DNI), or ambiguous.
- Dead-code candidates grouped by deterministic reachability class: product-reachable, startup-reachable, test-only, unproven public API, dynamic unknown, and disconnected candidate. A candidate is never declared safe to delete without isolated validation.
- Documentation-versus-code drift, including undocumented behavior, unsupported promises, partial promises, and documentation claims that cannot be mapped to implementation evidence.

## Why it is trustworthy

The deterministic graph is the evidence boundary. Parsing, framework recognition, entrypoints, source ranges, SHA-256 content hashes, reachability, feature membership, statuses, and dead-code verdicts are computed in code. The language model never decides membership or verdicts; in assisted mode, DeepSeek can only propose human-readable labels and tightly bounded documentation mappings, which deterministic validation may reject. Gold-standard release oracles live in `bench/oracles/`, repeated-run checks require stable memberships, statuses, canonical IDs, and dead-code candidates, and assisted functionality audits make at most two DeepSeek-only requests. Deterministic mode makes none. See [the architecture](docs/architecture.md) for the full boundary.

## Verified results

| Repository | Features | Dead-code candidates | Oracle |
| --- | ---: | ---: | --- |
| Rentyl | 66 | 161 | PASS |
| AI-tutor | 28 | 17 | PASS |
| uptime-kuma | 102 | 89 | PASS (hand-derived) |
| InsectFlux | 343 | 529 | — |

## Language & framework support

The current evidence frontends cover JavaScript and TypeScript (`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts`) plus Python (`.py`, `.pyi`, and `.pyw`). Vue, Svelte, and Astro receive line-preserving analysis for their JavaScript/TypeScript script regions. Built-in conventions include Flask, FastAPI, Express, Next.js App Router, knex migrations, and npm-script entrypoints, with broader framework recognition documented in [the support contract](docs/FRAMEWORK_SUPPORT.md).

This is static analysis, not a language type checker or a runtime tracer. Go, Rust, Java, C#, Ruby, PHP, and other language families do not yet have source frontends. Generated code, reflection, `eval`, runtime route construction, monkey-patching, remote plugins, and unresolved dependency injection may remain unknown. Template semantics in Vue, Svelte, and Astro are shallower than JSX analysis, and detected frameworks are reported separately from fully understood conventions.

## Roadmap

- Maintainability scoring: dead-code ratio, unexplained-code percentage, test-only production code, and coupling.
- Change blast-radius analysis: show which features and shared subsystems can be affected when a file or symbol changes.
- Certification reports for reproducible release evidence and policy gates.
- Deeper language and framework support, with the same exact-source evidence requirements.

## License

Software Auditor is source-available under the [Functional Source License 1.1, MIT Future License](LICENSE). It is free for non-competing use. Commercial use that competes with Software Auditor requires a paid license. Each released version becomes available under MIT on the second anniversary of its release.
