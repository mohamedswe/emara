import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";
import { startFeatureMapServer, parseGitHubSpec } from "./serveFeatureMap.ts";

function send(port, { method = "GET", headers = {}, body = "", path = "/api/analyze" } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method, headers }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function session(t, analyze = async () => ({ repositoryName: "fixture" })) {
  const server = await startFeatureMapServer(0, { analyze });
  t.after(() => server.close());
  const page = await send(server.port, { path: "/" });
  const boot = JSON.parse(page.text.match(/<script id="emara-boot" type="application\/json">([\s\S]*?)<\/script>/u)[1]);
  return { ...server, token: boot.sessionToken };
}

test("localhost server rejects rebinding hosts and cross-site analysis without executing", async t => {
  let calls = 0;
  const server = await session(t, async () => { calls++; return {}; });
  assert.equal((await send(server.port, { path: "/", headers: { Host: `evil.example:${server.port}` } })).status, 421);
  assert.equal((await send(server.port, { method: "POST", headers: { "Content-Type": "text/plain" }, body: '{"target":"a/b"}' })).status, 415);
  assert.equal((await send(server.port, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"target":"a/b"}' })).status, 403);
  assert.ok(server.token?.length >= 64);
  const other = await session(t);
  assert.notEqual(server.token, other.token);
  assert.equal((await send(server.port, { method: "POST", headers: { "Content-Type": "application/json", "X-Emara-Token": other.token }, body: '{"target":"a/b"}' })).status, 403);
  const headers = { "Content-Type": "application/json", "X-Emara-Token": server.token, Origin: "https://evil.example" };
  assert.equal((await send(server.port, { method: "POST", headers, body: '{"target":"a/b"}' })).status, 403);
  assert.equal(calls, 0);
  headers.Origin = `http://127.0.0.1:${server.port}`;
  assert.equal((await send(server.port, { method: "POST", headers, body: '{"target":"a/b"}' })).status, 200);
  assert.equal(calls, 1);
});

test("analysis rejects oversized and invalid bodies before executing", async t => {
  let calls = 0;
  const server = await session(t, async () => { calls++; return {}; });
  const headers = { "Content-Type": "application/json", "X-Emara-Token": server.token };
  assert.equal((await send(server.port, { method: "POST", headers, body: JSON.stringify({ target: "x".repeat(17000) }) })).status, 413);
  for (const body of ['null', '{"target":4}', '{}', '{"target":"  "}']) {
    assert.equal((await send(server.port, { method: "POST", headers, body })).status, 400);
  }
  assert.equal(calls, 0);
});

test("analysis coalesces identical in-flight requests and refuses other concurrent work", async t => {
  let calls = 0;
  let started;
  let release;
  const ready = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const server = await session(t, async () => { calls++; started(); await gate; return {}; });
  const headers = { "Content-Type": "application/json", "X-Emara-Token": server.token };
  const first = send(server.port, { method: "POST", headers, body: '{"target":"a/b"}' });
  await ready;
  const duplicate = send(server.port, { method: "POST", headers, body: '{"target":"a/b"}' });
  const busy = await Promise.race([
    send(server.port, { method: "POST", headers, body: '{"target":"c/d"}' }),
    new Promise(resolve => { const timer = setTimeout(() => resolve({ status: 0 }), 200); timer.unref(); }),
  ]);
  release();
  assert.equal(busy.status, 429);
  assert.equal((await first).status, 200);
  assert.equal((await duplicate).status, 200);
  assert.equal(calls, 1);
});

test("failed analysis clears in-flight state so a later request can run", async t => {
  let calls = 0;
  const server = await session(t, async () => {
    if (++calls === 1) throw new Error("fixture failure");
    return { repositoryName: "recovered" };
  });
  const headers = { "Content-Type": "application/json", "X-Emara-Token": server.token };
  const first = await send(server.port, { method: "POST", headers, body: '{"target":"a/b"}' });
  assert.equal(first.status, 400);
  assert.match(first.text, /fixture failure/);
  const second = await send(server.port, { method: "POST", headers, body: '{"target":"c/d"}' });
  assert.equal(second.status, 200);
  assert.equal(calls, 2);
});

test("rejects CSRF-style simple requests and opaque origins before analysis", async t => {
  let calls = 0;
  const server = await session(t, async () => { calls++; return {}; });
  const body = '{"target":"a/b"}';
  assert.equal((await send(server.port, { method: "POST", headers: { "Content-Type": "text/plain", Origin: "http://evil.example" }, body })).status, 415);
  assert.equal((await send(server.port, { method: "POST", headers: { "Content-Type": "application/json", Origin: "null", "X-Emara-Token": server.token }, body })).status, 403);
  assert.equal((await send(server.port, { method: "POST", headers: { "Content-Type": "application/json", Host: `evil.example:${server.port}`, "X-Emara-Token": server.token }, body })).status, 421);
  assert.equal(calls, 0);
});

test("oversized streaming uploads receive 413 and the server closes the connection", async t => {
  const server = await session(t);
  const outcome = await new Promise((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1",
      port: server.port,
      path: "/api/analyze",
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Emara-Token": server.token, "Content-Length": "10000000" },
    }, res => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, connection: res.headers.connection }));
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error("server kept the oversized upload open")); }, 2000);
    req.on("error", () => {});
    req.on("close", () => clearTimeout(timer));
    req.write("x".repeat(17_000));
  });
  assert.equal(outcome.status, 413);
  assert.equal(outcome.connection, "close");
});

test("rejects option-like Git refs before invoking Git", () => {
  assert.equal(parseGitHubSpec("owner/repo@--help"), null);
  assert.equal(parseGitHubSpec("https://github.com/owner/repo/tree/-v"), null);
  assert.equal(parseGitHubSpec("owner/repo@feature/safe").ref, "feature/safe");
});
