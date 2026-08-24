import type {
  ContractDiscoveryModel,
  ContractModelRequest,
  ContractModelResponse,
  ContractModelUsage,
} from "./model.js";

export interface DeepSeekChatModelOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
}

interface DeepSeekMessage extends Record<string, unknown> {
  role: "system" | "user" | "assistant" | "tool";
}

export class DeepSeekChatModel implements ContractDiscoveryModel {
  readonly provider = "deepseek";
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  #requests = 0;
  #promptTokens = 0;
  #completionTokens = 0;
  #totalTokens = 0;

  constructor(options: DeepSeekChatModelOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new Error("DeepSeek API key must not be empty");
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(
      /\/+$/,
      "",
    );
    if (this.#baseUrl.length === 0) {
      throw new Error("DeepSeek base URL must not be empty");
    }
    this.#fetch = options.fetchImplementation ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") {
      throw new Error("A Fetch API implementation is required");
    }
  }

  async createResponse(
    request: ContractModelRequest,
  ): Promise<ContractModelResponse> {
    const tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    const body: Record<string, unknown> = {
      model: request.model,
      messages: createMessages(request),
      max_tokens: request.max_output_tokens,
      response_format: { type: "json_object" },
      stream: false,
      temperature: 0,
      // DeepSeek thinking-mode tool calls require reasoning_content to be replayed.
      // Contract discovery does not need chain-of-thought, so disable it explicitly.
      thinking: { type: "disabled" },
    };
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const response = await fetchWithRetry(this.#fetch, `${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 2_000);
      throw new Error(
        `DeepSeek Chat Completions request failed with ${response.status} ${response.statusText}: ${responseBody}`,
      );
    }

    const value: unknown = await response.json();
    if (!isRecord(value) || !Array.isArray(value.choices)) {
      throw new Error("DeepSeek Chat Completions returned an invalid response object");
    }
    const choice = value.choices[0];
    if (!isRecord(choice) || !isRecord(choice.message)) {
      throw new Error("DeepSeek Chat Completions returned no response choice");
    }

    const output = extractToolCalls(choice.message);
    const content = choice.message.content;
    if (content !== null && content !== undefined && typeof content !== "string") {
      throw new Error("DeepSeek Chat Completions returned invalid message content");
    }

    const usage = extractUsage(value);
    this.#requests += 1;
    this.#promptTokens += usage?.promptTokens ?? 0;
    this.#completionTokens += usage?.completionTokens ?? 0;
    this.#totalTokens += usage?.totalTokens ?? 0;

    return {
      id: typeof value.id === "string" ? value.id : null,
      status:
        typeof choice.finish_reason === "string" ? choice.finish_reason : null,
      output,
      outputText: output.length === 0 && typeof content === "string" ? content : null,
      ...(usage === undefined ? {} : { usage }),
    };
  }

  /** Cumulative token usage across every createResponse call on this instance. */
  getUsage(): { requests: number } & ContractModelUsage {
    return {
      requests: this.#requests,
      promptTokens: this.#promptTokens,
      completionTokens: this.#completionTokens,
      totalTokens: this.#totalTokens,
    };
  }
}

/**
 * Fetch with retry + exponential backoff. Transient failures — network errors
 * ("fetch failed"), 429 rate limits, and 5xx server errors — are retried up to
 * 4 times (2s, 4s, 8s). A single dropped connection must not kill a multi-minute
 * audit. Client errors (4xx other than 429) are not retryable and throw at once.
 */
async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: Parameters<typeof fetch>[1],
  maxAttempts = 4,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, init);
      if (response.ok) return response;
      // Retry rate limits and server errors; fail fast on other 4xx.
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
        if (attempt < maxAttempts) await sleep(backoffMs(attempt));
        continue;
      }
      return response; // non-retryable 4xx — caller handles the error body
    } catch (error) {
      // Network-level failure (fetch failed, DNS, connection reset).
      lastError = error;
      if (attempt < maxAttempts) await sleep(backoffMs(attempt));
    }
  }
  throw lastError instanceof Error
    ? new Error(`DeepSeek request failed after ${maxAttempts} attempts: ${lastError.message}`)
    : new Error(`DeepSeek request failed after ${maxAttempts} attempts`);
}

function backoffMs(attempt: number): number {
  return 1000 * 2 ** attempt; // 2s, 4s, 8s
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function extractUsage(value: Record<string, unknown>): ContractModelUsage | undefined {
  if (!isRecord(value.usage)) return undefined;
  const prompt = value.usage.prompt_tokens;
  const completion = value.usage.completion_tokens;
  const total = value.usage.total_tokens;
  if (
    typeof prompt !== "number" ||
    typeof completion !== "number" ||
    typeof total !== "number"
  ) {
    return undefined;
  }
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
}

function createMessages(request: ContractModelRequest): DeepSeekMessage[] {
  const messages: DeepSeekMessage[] = [
    {
      role: "system",
      content: [
        request.instructions,
        "When you finish using tools, return only one JSON object that matches this JSON Schema:",
        JSON.stringify(request.text.format.schema),
      ].join("\n\n"),
    },
  ];
  let pendingToolCalls: Array<Record<string, unknown>> = [];

  const flushToolCalls = (): void => {
    if (pendingToolCalls.length === 0) return;
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: pendingToolCalls,
    });
    pendingToolCalls = [];
  };

  for (const item of request.input) {
    if (!isRecord(item)) {
      throw new Error("DeepSeek request input items must be objects");
    }
    if (item.type === "function_call") {
      if (
        typeof item.call_id !== "string" ||
        typeof item.name !== "string" ||
        typeof item.arguments !== "string"
      ) {
        throw new Error("DeepSeek request contains an invalid function call");
      }
      pendingToolCalls.push({
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      });
      continue;
    }

    flushToolCalls();
    if (item.type === "function_call_output") {
      if (typeof item.call_id !== "string" || typeof item.output !== "string") {
        throw new Error("DeepSeek request contains an invalid tool result");
      }
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: item.output,
      });
      continue;
    }
    if (
      (item.role === "user" ||
        item.role === "assistant" ||
        item.role === "system") &&
      typeof item.content === "string"
    ) {
      messages.push({ role: item.role, content: item.content });
      continue;
    }
    throw new Error("DeepSeek request contains an unsupported input item");
  }
  flushToolCalls();
  return messages;
}

function extractToolCalls(message: Record<string, unknown>): unknown[] {
  if (message.tool_calls === undefined || message.tool_calls === null) return [];
  if (!Array.isArray(message.tool_calls)) {
    throw new Error("DeepSeek Chat Completions returned invalid tool calls");
  }
  return message.tool_calls.map((toolCall) => {
    if (
      !isRecord(toolCall) ||
      typeof toolCall.id !== "string" ||
      !isRecord(toolCall.function) ||
      typeof toolCall.function.name !== "string" ||
      typeof toolCall.function.arguments !== "string"
    ) {
      throw new Error("DeepSeek Chat Completions returned an invalid tool call");
    }
    return {
      type: "function_call",
      call_id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
