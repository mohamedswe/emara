# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Software engineers, tech leads, and technical auditors taking over, reviewing, or maintaining unfamiliar JavaScript, TypeScript, and Python repositories. They work on desktop browsers alongside an IDE or terminal and need to quickly locate where product capabilities live in source code, verify whether documentation matches implementation reality, and inspect candidate dead code before touching anything.

## Product Purpose

Emara is a local, deterministic codebase functionality auditor and interactive feature architecture visualizer. It indexes a repository's AST and dependency graph, slices external entrypoints into cohesive capabilities and shared subsystems, flags documentation-versus-code drift, and classifies dead-code candidates by deterministic reachability. Success means an engineer can orient on an unfamiliar repository in minutes and verify every architectural claim directly against exact file paths, line ranges, and SHA-256 content hashes.

## Positioning

The deterministic dependency graph is the evidence boundary. Unlike LLM-first codebase summarizers that hallucinate relationships or drift between runs, Emara runs locally in deterministic mode with zero model requests and without executing target application code. Every feature boundary, shared subsystem connection, and cleanup candidate is backed by static AST and graph reachability evidence, and findings are explicitly framed as leads for human verification rather than automatic proof of runtime behavior.

## Operating Context

- Used as a local browser workspace (`npm run serve` on `127.0.0.1`) to analyze local checkouts or `owner/repo@commit` targets, and published as static, zero-backend browser snapshots (`demo/*.html`) for pinned open-source repositories.
- Core workflows:
  1. **Landing / Snapshot Selection:** Paste a commit SHA or `owner/repo@commit` (local server) or select a pinned repository snapshot (`louislam/uptime-kuma`, `fastapi/full-stack-fastapi-template`, `alan2207/bulletproof-react`).
  2. **Capability & Dependency Exploration:** Filter and browse capabilities (`Features`), shared infrastructure (`Shared & Core`), and cleanup candidates (`Deletion review`), tracing how external entrypoints (HTTP routes, CLI scripts, UI screens) connect through implementation files and owned symbols to outbound shared modules.
  3. **Source Evidence Inspection:** Click any entrypoint, file, symbol, or dependency edge to read the exact embedded source lines and SHA-256 hash in place.
  4. **Static Removal Simulation:** Toggle "Simulate Removal" on a feature to preview which files are statically exclusive to that capability and which shared modules would drop to a single consumer or become orphaned—always clearly labeled as static exclusivity rather than deletion validation.

## Capabilities and Constraints

- Single self-contained HTML shell rendered by `src/map/renderFeatureMapHtml.ts` for both live local server mode and static GitHub Pages demo builds (`src/map/buildStaticDemos.ts`).
- Strict Content-Security-Policy (`default-src 'none'`; inline styles, SHA-256-pinned inline script, `img-src 'self' data:`, `connect-src 'self'`) because the viewer embeds untrusted repository source code as data. No third-party CDN stylesheets or scripts are permitted at runtime.
- Must preserve honest epistemic framing: static analysis can be wrong, and "Simulate Removal" previews static file exclusivity rather than proving a file is safe to delete.
- All existing tests (`npm test` and `npm run typecheck`) including `src/map/__tests__/` must pass.

## Brand Commitments

- Name: **Emara**
- Voice: Direct, rigorous, engineering-honest, and zero-hype. Never claims AI magic or automatic deletion safety.

## Evidence on Hand

- Pinned deterministic viewer payloads in `demo-data/` (`uptime-kuma.json`, `full-stack-fastapi-template.json`, `bulletproof-react.json`) with SHA-256 manifest verification in `demo-data/manifest.json`.
- Reviewed room-booking audit sample in `docs/samples/room-booking/`.
- Walkthrough video and preview assets in `docs/media/` (`emara-preview.png`, `emara-walkthrough.mp4`, `emara-linkedin.mp4`).

## Product Principles

1. **Evidence over assertion:** Every architectural block, route, and edge must lead directly to verifiable file paths, line numbers, and SHA-256 source hashes.
2. **Epistemic honesty:** Clearly distinguish deterministic reachability and static exclusivity from runtime proof; never overstate what static analysis establishes.
3. **High-density scanability:** A developer scanning 80+ features, routes, and source files needs immediate typographic hierarchy, scannable topology, and zero decorative clutter.
4. **Self-contained security:** The visualizer must operate within its strict zero-external-network CSP boundary without sacrificing typographic or visual craft.
