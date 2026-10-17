import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { buildFunctionalityAudit } from "../audit/buildFunctionalityAudit.ts";
import { indexRepository } from "../graph/indexRepository.ts";
import { buildFeatureMap } from "./buildFeatureMap.ts";
import { createPayloadCache } from "./payloadCache.ts";
import { renderFeatureMapAppShellHtml, type ViewerPayload } from "./renderFeatureMapHtml.ts";

const execFileAsync = promisify(execFile);

export interface ResolvedAnalyzeTarget {
  displayLabel: string;
  repositoryName: string;
  repositoryPath: string;
  commit: string;
  cleanup?: () => Promise<void>;
}

export interface PresetTarget {
  id: string;
  label: string;
  subtitle: string;
  path: string;
}

const payloadCache = createPayloadCache({ maxEntries: 8, maxBytes: 64 * 1024 * 1024 });

export function discoverPresetTargets(): PresetTarget[] {
  const famousRoot = resolve(tmpdir(), "emara-famous-repos");
  const candidates: PresetTarget[] = [
    {
      id: "uptime-kuma",
      label: "louislam/uptime-kuma",
      subtitle: "Local checkout · Self-hosted monitoring tool (Node + Express + Vue)",
      path: resolve(famousRoot, "uptime-kuma"),
    },
    {
      id: "full-stack-fastapi-template",
      label: "fastapi/full-stack-fastapi-template",
      subtitle: "Local checkout · FastAPI + React + SQLModel stack",
      path: resolve(famousRoot, "full-stack-fastapi-template"),
    },
    {
      id: "bulletproof-react",
      label: "alan2207/bulletproof-react",
      subtitle: "Local checkout · React / Next.js feature architecture",
      path: resolve(famousRoot, "bulletproof-react"),
    },
  ];
  return candidates.filter((c) => existsSync(c.path));
}

export async function analyzeTargetToPayload(
  rawInput: string,
): Promise<ViewerPayload> {
  const target = await resolveAnalyzeInput(rawInput);
  const cacheKey = `${target.repositoryName}@${target.commit}`;
  const cached = payloadCache.get(cacheKey);
  if (cached !== undefined) {
    if (target.cleanup) await target.cleanup();
    return cached;
  }

  try {
    const precomputedHtmlPath = resolve(
      target.repositoryPath,
      "audit-output",
      "feature-map.html",
    );
    if (!target.cleanup && existsSync(precomputedHtmlPath)) {
      const htmlText = await readFile(precomputedHtmlPath, "utf8");
      const match = htmlText.match(
        /<script id="emara-boot" type="application\/json">([\s\S]*?)<\/script>/u,
      );
      if (match?.[1] !== undefined) {
        const parsedBoot = JSON.parse(match[1]) as { initialPayload?: ViewerPayload };
        if (
          parsedBoot.initialPayload &&
          parsedBoot.initialPayload.featureMap.repositoryCommit === target.commit
        ) {
          const payload: ViewerPayload = {
            ...parsedBoot.initialPayload,
            repositoryName: target.repositoryName,
          };
          payloadCache.set(cacheKey, payload);
          return payload;
        }
      }
    }

    const { graph, sourceFiles } = await indexRepository(target.repositoryPath);
    const audit = await buildFunctionalityAudit(
      graph,
      target.repositoryPath,
      undefined,
      {
        repositoryCommit: target.commit,
        deterministic: true,
        cache: "cold",
        indexedSourceFiles: sourceFiles,
      },
    );
    const featureMap = buildFeatureMap(graph, audit);
    const payload = renderFeatureMapAppShellHtml.buildPayload({
      repositoryName: target.repositoryName,
      graph,
      featureMap,
      sourceFiles,
    });
    payloadCache.set(cacheKey, payload);
    return payload;
  } finally {
    if (target.cleanup) {
      await target.cleanup().catch(() => {});
    }
  }
}

export async function resolveAnalyzeInput(
  rawInput: string,
): Promise<ResolvedAnalyzeTarget> {
  const input = rawInput.trim();
  if (input.length === 0) {
    throw new Error("Enter a commit SHA or GitHub owner/repo@commit.");
  }

  const presets = discoverPresetTargets();
  const matchedPreset = presets.find(
    (p) => p.id.toLowerCase() === input.toLowerCase() || p.label.toLowerCase() === input.toLowerCase(),
  );
  if (matchedPreset !== undefined) {
    const commit = await resolveGitCommit(matchedPreset.path, "HEAD");
    return {
      displayLabel: matchedPreset.label,
      repositoryName: matchedPreset.label,
      repositoryPath: matchedPreset.path,
      commit,
    };
  }

  // Case 1: Bare commit SHA or branch ref — search preset repositories only
  if (/^[0-9a-f]{7,40}$/iu.test(input) || input === "HEAD") {
    for (const preset of presets) {
      const resolvedCommit = await tryResolveGitCommit(preset.path, input);
      if (resolvedCommit !== null) {
        const checkout = await materializeLocalCommitIfNeeded(
          preset.path,
          preset.label,
          resolvedCommit,
        );
        return checkout;
      }
    }
    throw new Error(
      `Commit ${input} was not found in public demo repositories. For remote repositories, enter owner/repo@${input}.`,
    );
  }

  // Case 2: Remote GitHub URL or owner/repo[@commit]
  const remoteSpec = parseGitHubSpec(input);
  if (remoteSpec !== null) {
    return cloneRemoteSpec(remoteSpec);
  }

  throw new Error(
    `Could not resolve "${input}". Enter a commit SHA (e.g. 9b40ef9), owner/repo@commit, or GitHub URL.`,
  );
}

interface RemoteGitSpec {
  owner: string;
  repo: string;
  ref: string;
  cloneUrl: string;
}

export function parseGitHubSpec(input: string): RemoteGitSpec | null {
  // https://github.com/owner/repo/commit/<sha> or /tree/<ref>
  const urlMatch = input.match(
    /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/(?:commit|tree)\/([A-Za-z0-9_./-]+))?\/?$/iu,
  );
  if (urlMatch !== null) {
    const owner = urlMatch[1]!;
    const repo = urlMatch[2]!;
    const ref = urlMatch[3] ?? "HEAD";
    if (ref.startsWith("-")) return null;
    return {
      owner,
      repo,
      ref,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
    };
  }

  // owner/repo@ref or owner/repo#ref or owner/repo
  const shorthandMatch = input.match(
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:[@#]([A-Za-z0-9_./-]+))?$/u,
  );
  if (shorthandMatch !== null && !input.includes("\\") && !input.startsWith(".")) {
    const owner = shorthandMatch[1]!;
    const repo = shorthandMatch[2]!;
    const ref = shorthandMatch[3] ?? "HEAD";
    if (ref.startsWith("-")) return null;
    return {
      owner,
      repo,
      ref,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
    };
  }

  return null;
}

async function cloneRemoteSpec(spec: RemoteGitSpec): Promise<ResolvedAnalyzeTarget> {
  const workDir = resolve(
    tmpdir(),
    `emara-live-${spec.owner}-${spec.repo}-${createHash("sha256")
      .update(`${spec.cloneUrl}@${spec.ref}:${Date.now()}`)
      .digest("hex")
      .slice(0, 10)}`,
  );
  await mkdir(workDir, { recursive: true });

  const cleanup = async (): Promise<void> => {
    await rm(workDir, { recursive: true, force: true });
  };

  try {
    await runGit(workDir, ["init", "-q"]);
    await runGit(workDir, ["remote", "add", "origin", spec.cloneUrl]);
    await runGit(workDir, ["fetch", "--depth", "1", "--end-of-options", "origin", spec.ref]);
    await runGit(workDir, ["checkout", "-q", "FETCH_HEAD"]);
    const commit = await resolveGitCommit(workDir, "HEAD");
    return {
      displayLabel: `${spec.owner}/${spec.repo}`,
      repositoryName: `${spec.owner}/${spec.repo}`,
      repositoryPath: workDir,
      commit,
      cleanup,
    };
  } catch (error) {
    await cleanup().catch(() => {});
    throw new Error(
      `Failed to fetch ${spec.owner}/${spec.repo}@${spec.ref}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function materializeLocalCommitIfNeeded(
  repoPath: string,
  repoName: string,
  commit: string,
): Promise<ResolvedAnalyzeTarget> {
  const headCommit = await resolveGitCommit(repoPath, "HEAD");
  if (headCommit === commit) {
    return {
      displayLabel: repoName,
      repositoryName: repoName,
      repositoryPath: repoPath,
      commit,
    };
  }

  const workDir = resolve(
    tmpdir(),
    `emara-worktree-${repoName}-${commit.slice(0, 10)}-${Date.now()}`,
  );
  await runGit(repoPath, ["worktree", "add", "--detach", workDir, commit]);
  return {
    displayLabel: repoName,
    repositoryName: repoName,
    repositoryPath: workDir,
    commit,
    cleanup: async () => {
      await runGit(repoPath, ["worktree", "remove", "--force", workDir]).catch(
        async () => {
          await rm(workDir, { recursive: true, force: true });
        },
      );
    },
  };
}

async function tryResolveGitCommit(
  repoPath: string,
  ref: string,
): Promise<string | null> {
  try {
    return await resolveGitCommit(repoPath, ref);
  } catch {
    return null;
  }
}

async function resolveGitCommit(repoPath: string, ref: string): Promise<string> {
  const stdout = await runGit(repoPath, ["rev-parse", "--verify", `${ref}^{commit}`]);
  return stdout.trim();
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const safeDir = cwd.replaceAll("\\", "/");
  const { stdout } = await execFileAsync(
    "git",
    ["-c", `safe.directory=${safeDir}`, "-C", cwd, ...args],
    { encoding: "utf8", windowsHide: true, timeout: 60_000 },
  );
  return stdout;
}

export function startFeatureMapServer(
  port = 4173,
  options: { analyze?: (input: string) => Promise<ViewerPayload> } = {},
): Promise<{
  port: number;
  url: string;
  close: () => Promise<void>;
}> {
  const presets = discoverPresetTargets();
  const sessionToken = randomBytes(32).toString("hex");
  const analyze = options.analyze ?? analyzeTargetToPayload;
  const inflight = new Map<string, Promise<ViewerPayload>>();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const address = server.address();
      const actualPort = typeof address === "object" && address !== null ? address.port : port;
      const allowedHosts = new Set([`localhost:${actualPort}`, `127.0.0.1:${actualPort}`]);
      if (!allowedHosts.has(req.headers.host ?? "")) {
        res.writeHead(421).end("Bad host");
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/feature-map.html")) {
        const html = renderFeatureMapAppShellHtml({
          presets,
          sessionToken,
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/presets") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ presets }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/analyze") {
        if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
          res.writeHead(415).end("JSON required");
          return;
        }
        if (req.headers["x-emara-token"] !== sessionToken ||
            (req.headers.origin !== undefined && ![...allowedHosts].some(host => req.headers.origin === `http://${host}`))) {
          res.writeHead(403).end("Forbidden");
          return;
        }
        const body = await readRequestBody(req);
        const parsed: unknown = JSON.parse(body || "{}");
        if (typeof parsed !== "object" || parsed === null || !("target" in parsed) || typeof parsed.target !== "string" || !parsed.target.trim()) {
          throw new Error("A non-empty target string is required");
        }
        const targetInput = parsed.target.trim();
        let work = inflight.get(targetInput);
        if (work === undefined) {
          if (inflight.size > 0) {
            res.writeHead(429, { "Retry-After": "5" }).end("Another analysis is running");
            return;
          }
          work = Promise.resolve().then(() => analyze(targetInput));
          inflight.set(targetInput, work);
          const clear = (): void => { if (inflight.get(targetInput) === work) inflight.delete(targetInput); };
          void work.then(clear, clear);
        }
        const startedAt = Date.now();
        const payload = await work;
        const elapsedMs = Date.now() - startedAt;
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, elapsedMs, payload }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "Not found" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RequestBodyTooLargeError) {
        // Do not keep reading an oversized body: answer, then drop the socket.
        res.setHeader("Connection", "close");
        res.once("finish", () => req.destroy());
      }
      res.writeHead(error instanceof RequestBodyTooLargeError ? 413 : 400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: message }));
    }
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr !== null ? addr.port : port;
      resolvePromise({
        port: actualPort,
        url: `http://localhost:${actualPort}`,
        close: () =>
          new Promise<void>((resClose, rejClose) =>
            server.close((err) => (err ? rejClose(err) : resClose())),
          ),
      });
    });
  });
}

class RequestBodyTooLargeError extends Error {}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16 * 1024) {
        chunks.length = 0;
        req.removeAllListeners("data");
        req.pause();
        rejectPromise(new RequestBodyTooLargeError("Request body exceeds 16 KiB"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectPromise);
    req.on("aborted", () => rejectPromise(new Error("Request aborted")));
  });
}

const entryPath = process.argv[1];
if (entryPath !== undefined && entryPath.endsWith("serveFeatureMap.ts")) {
  const portArg = Number(process.env.PORT || process.argv[2] || "4173");
  startFeatureMapServer(portArg)
    .then(({ url }) => {
      console.log(`[emara-web] listening on ${url}`);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
