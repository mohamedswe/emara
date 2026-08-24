import type { ContractToolDefinition } from "./discoveryTools.js";

export interface ContractModelRequest {
  model: string;
  instructions: string;
  input: unknown[];
  tools: readonly ContractToolDefinition[];
  text: {
    format: {
      type: "json_schema";
      name: string;
      description: string;
      strict: true;
      schema: Record<string, unknown>;
    };
  };
  parallel_tool_calls: false;
  store: false;
  max_output_tokens: number;
}

export interface ContractModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ContractModelResponse {
  id: string | null;
  status: string | null;
  output: unknown[];
  outputText: string | null;
  usage?: ContractModelUsage;
}

export interface ContractDiscoveryModel {
  readonly provider: string;
  createResponse(request: ContractModelRequest): Promise<ContractModelResponse>;
}
