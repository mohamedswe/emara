import assert from "node:assert/strict";
import { test } from "node:test";

import { DeepSeekChatModel } from "./deepSeekChatModel.ts";

test("translates contract requests to DeepSeek chat completions without leaking the key", async () => {
  const calls = [];
  const model = new DeepSeekChatModel({
    apiKey: "secret-deepseek-key",
    baseUrl: "https://example.test/",
    fetchImplementation: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          id: "chat-1",
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: '{"ok":true}' },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  const response = await model.createResponse(requestFixture());

  assert.equal(calls[0].url, "https://example.test/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-deepseek-key");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(JSON.stringify(body).includes("secret-deepseek-key"), false);
  assert.equal(body.model, "deepseek-test");
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.temperature, 0);
  assert.match(body.messages[0].content, /JSON Schema/);
  assert.deepEqual(body.messages[1], { role: "user", content: "inspect" });
  assert.deepEqual(body.tools[0], {
    type: "function",
    function: {
      name: "get_source",
      description: "Read source",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  });
  assert.equal(response.outputText, '{"ok":true}');
  assert.equal(response.id, "chat-1");
  assert.equal(response.status, "stop");
});

test("replays tool history and normalizes DeepSeek tool calls", async () => {
  const calls = [];
  const model = new DeepSeekChatModel({
    apiKey: "key",
    fetchImplementation: async (_url, init) => {
      calls.push(init);
      return new Response(
        JSON.stringify({
          id: "chat-tools",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-2",
                    type: "function",
                    function: {
                      name: "get_source",
                      arguments: '{"id":"function:src/app.ts:health"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  const request = requestFixture();
  request.input.push(
    {
      type: "function_call",
      call_id: "call-1",
      name: "get_source",
      arguments: '{"id":"entrypoint:http:src/app.ts:1:GET /"}',
    },
    {
      type: "function_call_output",
      call_id: "call-1",
      output: '{"ok":true}',
    },
  );

  const response = await model.createResponse(request);

  const body = JSON.parse(calls[0].body);
  assert.deepEqual(
    body.messages.map((message) => message.role),
    ["system", "user", "assistant", "tool"],
  );
  assert.equal(body.messages[2].tool_calls[0].id, "call-1");
  assert.equal(body.messages[3].tool_call_id, "call-1");
  assert.deepEqual(response.output, [
    {
      type: "function_call",
      call_id: "call-2",
      name: "get_source",
      arguments: '{"id":"function:src/app.ts:health"}',
    },
  ]);
  assert.equal(response.outputText, null);
});

test("reports bounded DeepSeek errors and invalid response shapes", async () => {
  const failed = new DeepSeekChatModel({
    apiKey: "key",
    fetchImplementation: async () =>
      new Response("bad request", { status: 400, statusText: "Bad Request" }),
  });
  await assert.rejects(
    failed.createResponse(requestFixture()),
    /failed with 400 Bad Request: bad request/,
  );

  const invalid = new DeepSeekChatModel({
    apiKey: "key",
    fetchImplementation: async () =>
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });
  await assert.rejects(
    invalid.createResponse(requestFixture()),
    /returned no response choice/,
  );
});

test("request timeout bounds body consumption even when injected fetch ignores abort", async () => {
  let signal;
  const model = new DeepSeekChatModel({
    apiKey: "test-key",
    requestTimeoutMs: 15,
    fetchImplementation: async (_url, init) => {
      signal = init.signal;
      return { ok: true, json: () => new Promise(() => {}) };
    },
  });
  let guard;
  try {
    const outcome = await Promise.race([
      model.createResponse(requestFixture()).then(() => "resolved", (error) => error.message),
      new Promise((resolve) => { guard = setTimeout(() => resolve("missing timeout"), 150); }),
    ]);
    assert.match(outcome, /timed out after 15ms/i);
    assert.equal(signal.aborted, true);
    assert.equal(model.getUsage().requests, 0);
  } finally { clearTimeout(guard); }
});

test("rejects request timeout values outside the bounded supported range", () => {
  for (const requestTimeoutMs of [0, -1, NaN, Infinity, 1.5, 300_001]) {
    assert.throws(() => new DeepSeekChatModel({ apiKey: "test-key", requestTimeoutMs }), /requestTimeoutMs.*1.*300000/u);
  }
});

test("honors Retry-After seconds and releases the rejected response body", async () => {
  let attempts = 0;
  let cancelled = false;
  const model = new DeepSeekChatModel({
    apiKey: "test-key",
    requestTimeoutMs: 150,
    fetchImplementation: async () => {
      attempts += 1;
      if (attempts === 1) return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
        status: 429, headers: { "Retry-After": "0" },
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    },
  });
  const response = await model.createResponse(requestFixture());
  assert.equal(response.outputText, "ok");
  assert.equal(attempts, 2);
  assert.equal(cancelled, true);
});

test("honors Retry-After HTTP dates", async (context) => {
  const now = Date.UTC(2026, 0, 1);
  context.mock.method(Date, "now", () => now);
  const delays = [];
  const realSetTimeout = globalThis.setTimeout;
  context.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
    if (delay !== 60_000) delays.push(delay);
    return realSetTimeout(callback, delay === 60_000 ? delay : 0, ...args);
  });
  let attempts = 0;
  const model = new DeepSeekChatModel({
    apiKey: "test-key",
    fetchImplementation: async () => ++attempts === 1
      ? new Response("busy", { status: 503, headers: { "Retry-After": new Date(now + 5_000).toUTCString() } })
      : new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
  });
  await model.createResponse(requestFixture());
  assert.deepEqual(delays, [5_000]);
});

test("Retry-After rejects malformed numeric values and caps valid delays safely", async (context) => {
  context.mock.method(Date, "now", () => Date.UTC(2026, 0, 1));
  const delays = [];
  const realSetTimeout = globalThis.setTimeout;
  context.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
    if (delay !== 60_000) delays.push(delay);
    return realSetTimeout(callback, delay === 60_000 ? delay : 0, ...args);
  });
  const cases = [
    ["-1", 2_000], ["1.5", 2_000], ["1e3", 2_000], ["nonsense", 2_000],
    ["", 2_000], ["9".repeat(400), 30_000], ["999999999", 30_000],
    ["Thu, 01 Jan 2026 00:01:00 GMT", 30_000], ["Wed, 31 Dec 2025 23:59:00 GMT", 0],
  ];
  for (const [header, expected] of cases) {
    let attempts = 0;
    const model = new DeepSeekChatModel({
      apiKey: "test-key",
      fetchImplementation: async () => ++attempts === 1
        ? new Response("busy", { status: 429, headers: { "Retry-After": header } })
        : new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
    });
    await model.createResponse(requestFixture());
    assert.equal(delays.at(-1), expected, header);
  }
});

function requestFixture() {
  return {
    model: "deepseek-test",
    instructions: "Inspect evidence and return JSON.",
    input: [{ role: "user", content: "inspect" }],
    tools: [
      {
        type: "function",
        name: "get_source",
        description: "Read source",
        parameters: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
          additionalProperties: false,
        },
        strict: true,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "test",
        description: "test",
        strict: true,
        schema: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    parallel_tool_calls: false,
    store: false,
    max_output_tokens: 100,
  };
}
