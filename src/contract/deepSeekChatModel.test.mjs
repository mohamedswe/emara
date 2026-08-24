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
