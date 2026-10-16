# Pinned public-demo inputs

These are **existing audit results**, not newly computed or invented results. Each JSON file is the unmodified `initialPayload` recovered from the corresponding committed `demo/*.html` at auditor commit `44f1e968deee9dcfe9e62fdb11062903465d11b8`.

`manifest.json` records that source commit/path, the target repository commit already recorded by the audit, and SHA-256 of each JSON file (UTF-8, LF). The source-repository commits identify snapshots, not fresh audits or current repository state.

- `louislam/uptime-kuma`: `b092505f894d66669b67f46e1da72b51016eceab`
- `fastapi/full-stack-fastapi-template`: `b1125d8839482cb7bbae603ddc6d0081bf87532e`
- `alan2207/bulletproof-react`: `9506629ed003a561c6627735480cce4994244bb4`

Run `npm run build:demos` to regenerate all four public pages with the current renderer. The build needs no temporary reports, network fetches, target checkouts, or target-code execution. Missing, malformed, or checksum-mismatched inputs abort before any output is written. Tests check every emitted JSON script for raw `<`, fail-closed input validation, and deterministic rendering.

The maintainer-only `node demo-data/extract-inputs.mjs` reproduces this extraction from local Git history. It is not invoked by the build or tests, and requires that historical commit to be available (unlike ordinary builds, which work with a shallow checkout).

Generated `demo/` pages are not tracked (`/demo/` is in `.gitignore`). The Pages workflow runs only on `main`, waits for the reusable verification workflow, renders fresh pages with `npm run build:demos`, and uploads that output. Run `npm run build:demos` locally to preview.
