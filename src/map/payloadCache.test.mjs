import assert from "node:assert/strict";
import test from "node:test";
import { createPayloadCache } from "./payloadCache.ts";

test("payload cache evicts least recently used entries and bounds serialized bytes", () => {
  const cache = createPayloadCache({ maxEntries: 2, maxBytes: 100 });
  cache.set("a", { repositoryName: "a" });
  cache.set("b", { repositoryName: "b" });
  assert.equal(cache.get("a").repositoryName, "a");
  cache.set("c", { repositoryName: "c" });
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a").repositoryName, "a");
  cache.set("huge", { repositoryName: "x".repeat(101) });
  assert.equal(cache.get("huge"), undefined);
  const tight = createPayloadCache({ maxEntries: 8, maxBytes: 50 });
  tight.set("a", { repositoryName: "a" });
  tight.set("b", { repositoryName: "b" });
  tight.set("c", { repositoryName: "c" });
  assert.equal(tight.get("a"), undefined);
  assert.equal(tight.get("c").repositoryName, "c");
});
