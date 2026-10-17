# Security policy

Emara is an early static-analysis tool, not a security scanner or execution sandbox. Findings are investigation leads, not proof that code is safe, correct, or unused.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** (private security advisory) feature for this repository when it is available. Do not publish private source, credentials, or exploit details in a public issue. If private reporting is unavailable, open an issue asking for a private channel without including the details.

## Trust boundaries

- Deterministic audits (the default) parse files without running the target application and make no model requests. Reports and HTML viewers embed source excerpts and can contain private information; review them before sharing. Viewer pages carry a Content-Security-Policy that allows only their own script and load no third-party resources.
- Model assistance is off by default. `--model-assisted` explicitly permits sending repository evidence to the configured DeepSeek endpoint, which the CLI prints first. An API key alone does not opt in.
- `--validate-dead-code` executes caller-supplied commands in a disposable copy of the repository. It is **not** an OS sandbox: commands keep the invoking user's permissions and network access. Do not validate untrusted code on your host; use a disposable environment with no secrets and restricted network and filesystem access.
  - The copy refuses symlinks whose targets are absolute or point outside the repository, and copies contained links verbatim, so commands cannot write through a link into the original checkout.
  - On timeout, Linux and macOS kill the command's whole process group. On Windows, Emara uses `taskkill /T /F`, which cannot reach descendants whose parent has already exited; such processes can keep running. Prefer Linux, macOS, or the Docker image for validation.
- `npm run serve` listens on 127.0.0.1 only and requires a per-session token, an allowed `Host`/`Origin`, and a JSON body of at most 16 KiB (larger uploads are refused and the connection closed). Do not proxy it to other machines or expose it through a tunnel. For `owner/repo@commit` input it fetches that public GitHub repository over the network.
- GitHub Pages hosts fixed static snapshots built from pinned inputs; it runs no analysis backend.
- Cloning, parsing, and graph construction consume CPU, memory, and disk. Request and cache limits are not process isolation. Use a container or VM with resource limits for unfamiliar or very large repositories.
- In a Git work tree, git-ignored untracked files are not scanned, and `.env*` files are always skipped. Tracked secrets and secrets inside ordinary source files can still appear in reports; Emara does not detect or redact secrets.

## Container operation

The image runs as the unprivileged `node` user (UID 1000); application files under `/app` are not writable by that user. Mount the target read-only and provide a writable `/output` volume. On Linux the bind mount must be writable by the container user; prefer `--user "$(id -u):$(id -g)"` with an output directory you own over running as root. For deterministic audits, add `--network none --cap-drop ALL --security-opt no-new-privileges`. These settings reduce exposure but do not make hostile validation commands safe to run.

## Automated checks

CI runs the locked install, conflict-marker check, typecheck, and tests on Node 22 and 24. Image publishing builds the image and runs `scripts/smoke-container.mjs` (non-root user, read-only root-owned fixture, networking and capabilities disabled) before pushing. Pages deployment runs only from `main`, after the verification workflow, from a fresh build of the pinned demo inputs.
