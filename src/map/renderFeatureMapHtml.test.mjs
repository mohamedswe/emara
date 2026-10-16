import assert from "node:assert/strict";
import test from "node:test";
import { renderFeatureMapAppShellHtml } from "./renderFeatureMapHtml.ts";

test("boot JSON cannot escape its script element and preserves untrusted source text", () => {
  const hostile = '</ScRiPt ><!--<script></SCRIPT><img src=x onerror=alert(1)>&\u2028\u2029';
  const payload = { repositoryName: hostile, featureMap: {}, nodes: {}, sources: { "a.ts": { hash: "abc", lines: [hostile] } } };
  const html = renderFeatureMapAppShellHtml({ initialPayload: payload });
  const boot = html.match(/<script id="emara-boot" type="application\/json">([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(boot);
  assert.doesNotMatch(boot, /[<>&\u2028\u2029]/u);
  assert.deepEqual(JSON.parse(boot).initialPayload, payload);
});
