import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { renderFeatureMapAppShellHtml } from "./renderFeatureMapHtml.ts";

test("standalone HTML allows only its own hashed client script and never contacts font services", () => {
  const html = renderFeatureMapAppShellHtml();
  const client = html.match(/<script>([\s\S]*?)<\/script>/u)[1];
  const hash = createHash("sha256").update(client).digest("base64");
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/u)?.[1];
  assert.ok(policy);
  assert.ok(policy.includes(`script-src 'sha256-${hash}'`));
  assert.ok(policy.includes("default-src 'none'"));
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"));
  assert.match(html, /<meta name="referrer" content="no-referrer" \/>/u);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/u);
});

test("static demos disable arbitrary analysis instead of calling a missing backend", () => {
  const presets = [{ id: "fixture", label: "owner/repo", subtitle: "Snapshot", path: "fixture", url: "fixture.html" }];
  const html = renderFeatureMapAppShellHtml({ presets });
  assert.match(html, /Static snapshot demo/u);
  assert.match(html, /id="analyze-input"\s+disabled/u);
  assert.match(html, /id="analyze-submit" type="submit" disabled/u);
  assert.match(html, /Nothing is uploaded or analyzed from this page/u);

  const served = renderFeatureMapAppShellHtml({ presets, sessionToken: "a".repeat(64) });
  assert.doesNotMatch(served, /Static snapshot demo/u);
  assert.doesNotMatch(served, /id="analyze-input"\s+disabled/u);
});

test("viewer never presents static exclusivity as proof that deletion is safe", () => {
  const html = renderFeatureMapAppShellHtml();
  assert.doesNotMatch(html, /Safely deletes|Unused \/ Safe Delete|exclusive files can be deleted|'DELETE'/u);
  assert.match(html, /Deletion review/u);
  assert.match(html, /not validated for deletion/u);
  assert.match(html, /this does not prove that any file is safe to delete/u);
});

test("boot JSON cannot escape its script element and preserves untrusted source text", () => {
  const hostile = '</ScRiPt ><!--<script></SCRIPT><img src=x onerror=alert(1)>&\u2028\u2029';
  const payload = { repositoryName: hostile, featureMap: {}, nodes: {}, sources: { "a.ts": { hash: "abc", lines: [hostile] } } };
  const html = renderFeatureMapAppShellHtml({ initialPayload: payload });
  const boot = html.match(/<script id="emara-boot" type="application\/json">([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(boot);
  assert.doesNotMatch(boot, /[<>&\u2028\u2029]/u);
  assert.deepEqual(JSON.parse(boot).initialPayload, payload);
});
