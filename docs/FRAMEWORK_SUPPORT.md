65# Framework and language support

## The support contract

“Supports every JavaScript, TypeScript, and Python application” means every
recognized source file receives deterministic baseline analysis. It does not
mean static analysis can prove behavior created only at runtime through
reflection, generated code, remote plugins, monkey-patching, or `eval`.

The auditor reports three explicit levels:

- `baseline`: files, symbols, imports, exports, calls, source ranges, and parse
  diagnostics.
- `entrypoints`: baseline plus framework routes, commands, jobs, handlers,
  file routes, and application startup conventions.
- `semantic`: entrypoint support plus relationships such as `HANDLED_BY`,
  `RENDERS`, `PUBLISHES`, `SUBSCRIBES_TO`, and `VALIDATED_BY` when source
  evidence exists.

Unknown framework-like registrations are emitted as diagnostics. They are not
silently counted as covered and are not converted into speculative graph edges.

## Architecture

```text
scanner
  |
  v
language frontend -----> normalized ParsedSourceFile
  |                         symbols/imports/calls/events/renders/entrypoints
  v
framework registry ----> composable convention indexes
  |
  v
generic resolvers ------> IMPORTS / CALLS / REFERENCES
  |
  v
evidence graph ---------> stable nodes, source ranges, semantic edges
  |
  v
contract/review/coverage
```

Language frontends own grammar-specific facts. Framework packs own conventions.
The graph, retrieval, evidence, contradiction review, and coverage layers do not
depend on a particular framework.

### Language frontends

- JavaScript: `.js`, `.jsx`, `.mjs`, `.cjs`
- TypeScript: `.ts`, `.tsx`, `.mts`, `.cts`
- Python: `.py`, `.pyi`, `.pyw`
- Jupyter: line-preserving Python extraction from `.ipynb` code cells
- Embedded JavaScript/TypeScript: line-preserving `<script>` extraction from
  `.vue` and `.svelte`, plus Astro frontmatter and script blocks

The notebook and embedded extractors preserve original file line numbers. This
is essential because every evidence range must be verifiable by `get_source`.

### Built-in framework families

The catalog currently detects and supplies reusable conventions for:

- Node HTTP: Express, Fastify, Koa, Hapi
- Edge/alternative HTTP: Hono, Elysia, tRPC, Nitro/H3, AdonisJS
- Decorator applications: NestJS and Nest GraphQL/scheduling/events
- UI and full-stack: React, React Native, Expo, Next.js, Remix, Vue/Nuxt,
  Svelte/SvelteKit, Angular, Solid/SolidStart, Astro
- JavaScript CLI, event, queue, scheduler, GraphQL, serverless, Electron, and
  file-routed application families
- Python HTTP: FastAPI, Flask, Starlette, Litestar, aiohttp, Tornado, Sanic,
  Quart, and APIFlask-style conventions
- Django and Django REST Framework
- Python jobs/workflows: Celery, Airflow, Prefect, APScheduler, and RQ
- Python CLI: Click and Typer
- Python data UI/notebooks: Streamlit, Gradio, Dash, and Jupyter
- Python serverless handler conventions

Detection comes from imports, dependency manifests, and framework-owned file
patterns. Detection alone never creates an edge; an edge still needs source
syntax and an exact source range.

## Adding a framework

Framework registries are immutable. A repository can receive a custom registry
without changing process-wide state:

```ts
import { DEFAULT_FRAMEWORK_REGISTRY } from "../src/frameworks/registry.ts";
import { indexRepository } from "../src/graph/indexRepository.ts";

const registry = DEFAULT_FRAMEWORK_REGISTRY.with({
  id: "acme-web",
  displayName: "Acme Web",
  family: "custom-http",
  languages: ["typescript"],
  support: "entrypoints",
  versionPolicy: "major-fixtures",
  detection: {
    packageNames: ["acme-web"],
    importPrefixes: ["acme-web"],
  },
  javascript: {
    httpFactoryNames: ["AcmeApp"],
    httpMethods: ["get", "post"],
  },
});

await indexRepository(repositoryPath, { frameworkRegistry: registry });
```

Most packs are data. Procedural resolver code is reserved for semantics that
cannot be represented as signatures, such as JSX rendering, file routing,
module resolution, notebook cells, or framework-generated dependency injection.

Each new pack should include pinned fixtures for the framework’s supported major
versions. The registry’s `versionPolicy` makes that maintenance obligation
explicit; it is not a claim that every historical version has been tested.

## Why this design

### Tree-sitter rather than one compiler stack per language

Tree-sitter provides one in-process API, error recovery, concrete source ranges,
and the same traversal model for JavaScript, TypeScript, and Python. Using the
TypeScript compiler plus Babel plus a required CPython subprocess would provide
more type information, but would also create three incompatible node models,
environment-dependent Python behavior, and harder evidence normalization.

The tradeoff is deliberate: the baseline is syntax- and evidence-complete, not
a replacement for a language type checker. Type-checker/LSP enrichment can be
added later as optional resolver evidence.

### Framework packs rather than framework-specific parsers

Express, Fastify, Hono, Flask, and FastAPI use different registration syntax,
but they do not have different JavaScript or Python grammars. Full parsers per
framework would duplicate symbol, import, call, range, and error handling while
drifting in behavior. Packs express only the differences and share the language
frontend and graph core.

### Static-first rather than executing repositories

Executing an arbitrary audited repository can run installation scripts, access
credentials, mutate data, or depend on unavailable infrastructure. Static-first
analysis is deterministic, offline-capable, and safe for untrusted repositories.
Optional sandboxed runtime traces may later supplement static evidence, but must
never replace or silently override it.

### Deterministic extraction rather than LLM-only discovery

LLMs are useful for synthesizing capabilities and investigating uncertainty.
They are poor substitutes for stable IDs, exact source ranges, exhaustive import
resolution, and reproducible entrypoint detection. The deterministic graph is
therefore the evidence boundary; the model reasons over it and an independent
review checks its claims.

### Immutable registries rather than global plugin mutation

An immutable registry makes two concurrent scans reproducible even when they use
different custom packs. Global registration would make test order and long-lived
process state affect results.

## Honest limitations

- Vue, Svelte, Astro, and Angular template/render semantics are not yet as deep
  as JSX semantics; their JavaScript/TypeScript regions still receive baseline
  analysis.
- Dynamic route construction, generated modules, runtime dependency injection,
  reflection, and monkey-patching can remain unresolved.
- Compact notebook JSON that stores multiple code lines in one JSON string is
  diagnosed because it cannot provide a one-to-one original-file line mapping.
- Package aliases and monorepo mappings beyond relative JS/TS paths and Python
  package paths require future resolver plugins.
- “Detected” and “understood” are separate. Consult the reported support level
  and diagnostics instead of treating framework detection as full coverage.

## Compatibility checks

```powershell
npm run frameworks:list
npm run typecheck
npm test
```

The regression suite includes JavaScript, TypeScript, TSX, Python, FastAPI-style
routes, Django registrations, Celery tasks, Click commands, serverless handlers,
Hono-style factory aliases, Next/Expo file routes, Vue/Svelte/Astro extraction,
notebooks, Python module resolution, and cross-file Python calls.
