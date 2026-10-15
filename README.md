# Emara

Understand the codebase you are taking over. Emara identifies functionality in JavaScript, TypeScript, and Python repositories, points you to source locations, compares code with documentation, and flags potentially unused code for review.

It runs locally in deterministic mode with zero model requests. It parses the target repository rather than executing its application code. Static analysis can be wrong: source evidence helps you inspect a finding, not automatically trust it.

## See a real result before installing

[Read the reviewed room-booking sample](docs/samples/room-booking/README.md). It includes booking endpoints, links to exact source lines, one cleanup candidate, and known errors alongside the unchanged generated report. No installation is needed.

For example, Emara locates `DELETE /rooms/:id/:bookingId` at `api/routes/rooms.js:154`. The sample checks that handler against source and shows what the result does and does not establish.

Current status: early CLI for developer investigation. Documentation matching and legacy JSX import handling have known errors in this sample. Findings require review; no candidate is automatically safe to delete.

## Quickstart

With Docker running, replace `<absolute-repo-path>` with the absolute path to your Git repository (for example `/home/you/client-app` on Linux or `C:/projects/client-app` in PowerShell). The container writes an `audit-output` directory into the mounted repository:

```sh
docker run --rm -v "<absolute-repo-path>:/repo" ghcr.io/mohamedswe/emara:latest /repo --deterministic
```

Without `DEEPSEEK_API_KEY`, the container automatically enables deterministic mode. It writes `functionality-audit.json`, `graph.json`, `audit-report.md`, and `semantic-passes.json` under `<repo>/audit-output/`.

To run from source with npm, install Node.js 22.6 or newer and Git:

```sh
git clone https://github.com/mohamedswe/emara.git
cd emara
npm ci
npm run auditor -- <repo> --deterministic
```

Open `<repo>/audit-output/audit-report.md` when the run completes. The report starts with a Takeover Summary, then lists feature locations and review candidates. Keep `functionality-audit.json` and `graph.json` for structured evidence.

The [sample's unchanged report](docs/samples/room-booking/audit-report.md) shows the current output. Read its [review notes](docs/samples/room-booking/README.md#where-the-report-gets-it-wrong) before interpreting the counts or verdicts.

## What it finds

- Features classified as implemented and documented, implemented but undocumented, partially implemented, documented but not implemented (DNI), or ambiguous.
- Dead-code candidates grouped by deterministic reachability class: product-reachable, startup-reachable, test-only, unproven public API, dynamic unknown, and disconnected candidate. A candidate is never declared safe to delete without isolated validation.
- Documentation-versus-code drift, including undocumented behavior, unsupported promises, partial promises, and documentation claims that cannot be mapped to implementation evidence.

## How findings are produced

The deterministic graph is the evidence boundary. Parsing, framework recognition, entrypoints, source ranges, SHA-256 content hashes, reachability, feature membership, statuses, and dead-code verdicts are computed in code. The language model never decides membership or verdicts; in assisted mode, DeepSeek can only propose human-readable labels and tightly bounded documentation mappings, which deterministic validation may reject. Gold-standard release oracles live in `bench/oracles/`, repeated-run checks require stable memberships, statuses, canonical IDs, and dead-code candidates, and assisted functionality audits make at most two DeepSeek-only requests. Deterministic mode makes none. See [the architecture](docs/architecture.md) for the full boundary.

## Historical benchmark results

These are historical release checks, not fresh measurements for every engine change or accuracy percentages. An oracle PASS covers selected hand-written expectations, not every finding. The current [reproducible sample](docs/samples/room-booking/provenance.md) includes a fresh run and its known failures.

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
