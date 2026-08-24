import type {
  ContractDraft,
  ContractDraftCapability,
  ContractDraftFeatureDossier,
  ContractDraftRequirement,
  ContractDraftUncertainty,
  ContractDraftUserFlow,
  ContractDraftUserFlowStep,
  ContractRequirementCategory,
  FeatureReachability,
} from "./types.js";

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const REQUIREMENT_CATEGORIES = new Set<ContractRequirementCategory>([
  "behavior",
  "validation",
  "security",
  "dependency",
  "architecture",
  "reliability",
  "performance",
]);
const FEATURE_REACHABILITY = new Set<FeatureReachability>([
  "reachable",
  "internally_reachable",
  "test_only",
  "dead_or_unreferenced",
  "unknown",
]);

const EVIDENCE_NODE_IDS_SCHEMA = {
  type: "array",
  items: { type: "string" },
  maxItems: 6,
} as const;

export const CONTRACT_DRAFT_JSON_SCHEMA = {
  type: "object",
  properties: {
    featureDossiers: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          entrypoints: EVIDENCE_NODE_IDS_SCHEMA,
          ui: EVIDENCE_NODE_IDS_SCHEMA,
          handlers: EVIDENCE_NODE_IDS_SCHEMA,
          services: EVIDENCE_NODE_IDS_SCHEMA,
          schemas: EVIDENCE_NODE_IDS_SCHEMA,
          stateTransitions: EVIDENCE_NODE_IDS_SCHEMA,
          events: EVIDENCE_NODE_IDS_SCHEMA,
          tests: EVIDENCE_NODE_IDS_SCHEMA,
          config: EVIDENCE_NODE_IDS_SCHEMA,
          documentation: EVIDENCE_NODE_IDS_SCHEMA,
          evidenceNodeIds: EVIDENCE_NODE_IDS_SCHEMA,
          unresolvedQuestions: {
            type: "array",
            items: { type: "string" },
            maxItems: 6,
          },
          reachability: {
            type: "string",
            enum: [
              "reachable",
              "internally_reachable",
              "test_only",
              "dead_or_unreferenced",
              "unknown",
            ],
          },
        },
        required: [
          "id",
          "title",
          "entrypoints",
          "ui",
          "handlers",
          "services",
          "schemas",
          "stateTransitions",
          "events",
          "tests",
          "config",
          "documentation",
          "evidenceNodeIds",
          "unresolvedQuestions",
          "reachability",
        ],
        additionalProperties: false,
      },
    },
    capabilities: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          dossierId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          entrypointNodeIds: {
            type: "array",
            items: { type: "string" },
            maxItems: 6,
          },
          evidenceNodeIds: EVIDENCE_NODE_IDS_SCHEMA,
        },
        required: [
          "id",
          "dossierId",
          "title",
          "description",
          "entrypointNodeIds",
          "evidenceNodeIds",
        ],
        additionalProperties: false,
      },
    },
    userFlows: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          evidenceNodeIds: EVIDENCE_NODE_IDS_SCHEMA,
          steps: {
            type: "array",
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                order: { type: "integer" },
                statement: { type: "string" },
                evidenceNodeIds: EVIDENCE_NODE_IDS_SCHEMA,
              },
              required: ["order", "statement", "evidenceNodeIds"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "id",
          "title",
          "description",
          "evidenceNodeIds",
          "steps",
        ],
        additionalProperties: false,
      },
    },
    requirements: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: {
            type: "string",
            enum: [
              "behavior",
              "validation",
              "security",
              "dependency",
              "architecture",
              "reliability",
              "performance",
            ],
          },
          statement: { type: "string" },
          evidenceNodeIds: EVIDENCE_NODE_IDS_SCHEMA,
        },
        required: ["id", "category", "statement", "evidenceNodeIds"],
        additionalProperties: false,
      },
    },
    uncertainties: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          statement: { type: "string" },
          reason: { type: "string" },
          evidenceNodeIds: EVIDENCE_NODE_IDS_SCHEMA,
        },
        required: ["id", "statement", "reason", "evidenceNodeIds"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "featureDossiers",
    "capabilities",
    "userFlows",
    "requirements",
    "uncertainties",
  ],
  additionalProperties: false,
} as const;

export function validateContractDraft(
  value: unknown,
): asserts value is ContractDraft {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new Error("Invalid contract draft:\n- draft must be an object");
  }

  exactKeys(
    value,
    [
      "featureDossiers",
      "capabilities",
      "userFlows",
      "requirements",
      "uncertainties",
    ],
    "draft",
    issues,
  );
  const featureDossiers = arrayField(value, "featureDossiers", "draft", issues);
  const capabilities = arrayField(value, "capabilities", "draft", issues);
  const userFlows = arrayField(value, "userFlows", "draft", issues);
  const requirements = arrayField(value, "requirements", "draft", issues);
  const uncertainties = arrayField(value, "uncertainties", "draft", issues);
  const ids = new Set<string>();
  const dossierIds = new Set<string>();

  featureDossiers.forEach((item, index) =>
    validateFeatureDossier(item, index, dossierIds, issues),
  );

  capabilities.forEach((item, index) =>
    validateCapability(item, index, ids, dossierIds, issues),
  );
  userFlows.forEach((item, index) =>
    validateUserFlow(item, index, ids, issues),
  );
  requirements.forEach((item, index) =>
    validateRequirement(item, index, ids, issues),
  );
  uncertainties.forEach((item, index) =>
    validateUncertainty(item, index, ids, issues),
  );

  if (issues.length > 0) {
    throw new Error(
      `Invalid contract draft:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
    );
  }
}

function validateCapability(
  value: unknown,
  index: number,
  ids: Set<string>,
  dossierIds: ReadonlySet<string>,
  issues: string[],
): value is ContractDraftCapability {
  const location = `capabilities[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${location} must be an object`);
    return false;
  }

  exactKeys(
    value,
    [
      "id",
      "dossierId",
      "title",
      "description",
      "entrypointNodeIds",
      "evidenceNodeIds",
    ],
    location,
    issues,
  );
  validateId(value.id, location, ids, issues);
  nonEmptyString(value.dossierId, `${location}.dossierId`, issues);
  if (typeof value.dossierId === "string" && !dossierIds.has(value.dossierId)) {
    issues.push(`${location}.dossierId references missing feature dossier ${JSON.stringify(value.dossierId)}`);
  }
  nonEmptyString(value.title, `${location}.title`, issues);
  nonEmptyString(value.description, `${location}.description`, issues);
  stringArray(value.entrypointNodeIds, `${location}.entrypointNodeIds`, false, issues);
  stringArray(value.evidenceNodeIds, `${location}.evidenceNodeIds`, true, issues);
  return true;
}

function validateFeatureDossier(
  value: unknown,
  index: number,
  dossierIds: Set<string>,
  issues: string[],
): value is ContractDraftFeatureDossier {
  const location = `featureDossiers[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${location} must be an object`);
    return false;
  }
  const sectionKeys = [
    "entrypoints",
    "ui",
    "handlers",
    "services",
    "schemas",
    "stateTransitions",
    "events",
    "tests",
    "config",
    "documentation",
  ] as const;
  exactKeys(
    value,
    [
      "id",
      "title",
      ...sectionKeys,
      "evidenceNodeIds",
      "unresolvedQuestions",
      "reachability",
    ],
    location,
    issues,
  );
  validateId(value.id, location, dossierIds, issues);
  nonEmptyString(value.title, `${location}.title`, issues);
  for (const key of sectionKeys) {
    stringArray(value[key], `${location}.${key}`, false, issues);
  }
  stringArray(value.evidenceNodeIds, `${location}.evidenceNodeIds`, true, issues);
  stringArray(value.unresolvedQuestions, `${location}.unresolvedQuestions`, false, issues);
  if (
    typeof value.reachability !== "string" ||
    !FEATURE_REACHABILITY.has(value.reachability as FeatureReachability)
  ) {
    issues.push(`${location}.reachability is invalid`);
  }
  return true;
}

function validateUserFlow(
  value: unknown,
  index: number,
  ids: Set<string>,
  issues: string[],
): value is ContractDraftUserFlow {
  const location = `userFlows[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${location} must be an object`);
    return false;
  }

  exactKeys(
    value,
    ["id", "title", "description", "evidenceNodeIds", "steps"],
    location,
    issues,
  );
  validateId(value.id, location, ids, issues);
  nonEmptyString(value.title, `${location}.title`, issues);
  nonEmptyString(value.description, `${location}.description`, issues);
  stringArray(value.evidenceNodeIds, `${location}.evidenceNodeIds`, true, issues);
  const steps = arrayValue(value.steps, `${location}.steps`, issues);
  if (steps.length === 0) {
    issues.push(`${location}.steps must contain at least one step`);
  }
  steps.forEach((step, stepIndex) =>
    validateFlowStep(step, stepIndex, location, issues),
  );
  return true;
}

function validateFlowStep(
  value: unknown,
  index: number,
  flowLocation: string,
  issues: string[],
): value is ContractDraftUserFlowStep {
  const location = `${flowLocation}.steps[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${location} must be an object`);
    return false;
  }

  exactKeys(value, ["order", "statement", "evidenceNodeIds"], location, issues);
  if (value.order !== index + 1) {
    issues.push(`${location}.order must be ${index + 1}`);
  }
  nonEmptyString(value.statement, `${location}.statement`, issues);
  stringArray(value.evidenceNodeIds, `${location}.evidenceNodeIds`, true, issues);
  return true;
}

function validateRequirement(
  value: unknown,
  index: number,
  ids: Set<string>,
  issues: string[],
): value is ContractDraftRequirement {
  const location = `requirements[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${location} must be an object`);
    return false;
  }

  exactKeys(value, ["id", "category", "statement", "evidenceNodeIds"], location, issues);
  validateId(value.id, location, ids, issues);
  if (
    typeof value.category !== "string" ||
    !REQUIREMENT_CATEGORIES.has(value.category as ContractRequirementCategory)
  ) {
    issues.push(
      `${location}.category must be behavior, validation, security, dependency, architecture, reliability, or performance`,
    );
  }
  nonEmptyString(value.statement, `${location}.statement`, issues);
  stringArray(value.evidenceNodeIds, `${location}.evidenceNodeIds`, true, issues);
  return true;
}

function validateUncertainty(
  value: unknown,
  index: number,
  ids: Set<string>,
  issues: string[],
): value is ContractDraftUncertainty {
  const location = `uncertainties[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${location} must be an object`);
    return false;
  }

  exactKeys(value, ["id", "statement", "reason", "evidenceNodeIds"], location, issues);
  validateId(value.id, location, ids, issues);
  nonEmptyString(value.statement, `${location}.statement`, issues);
  nonEmptyString(value.reason, `${location}.reason`, issues);
  stringArray(value.evidenceNodeIds, `${location}.evidenceNodeIds`, false, issues);
  return true;
}

function validateId(
  value: unknown,
  location: string,
  ids: Set<string>,
  issues: string[],
): void {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    issues.push(`${location}.id must be a lowercase kebab-case identifier`);
    return;
  }
  if (ids.has(value)) {
    issues.push(`${location}.id duplicates contract item ID ${JSON.stringify(value)}`);
    return;
  }
  ids.add(value);
}

function stringArray(
  value: unknown,
  location: string,
  requireValue: boolean,
  issues: string[],
): string[] {
  const values = arrayValue(value, location, issues);
  if (requireValue && values.length === 0) {
    issues.push(`${location} must contain at least one node ID`);
  }
  const seen = new Set<string>();
  for (const [index, item] of values.entries()) {
    if (typeof item !== "string" || item.length === 0) {
      issues.push(`${location}[${index}] must be a non-empty string`);
      continue;
    }
    if (seen.has(item)) {
      issues.push(`${location}[${index}] duplicates node ID ${JSON.stringify(item)}`);
    }
    seen.add(item);
  }
  return values.filter((item): item is string => typeof item === "string");
}

function nonEmptyString(
  value: unknown,
  location: string,
  issues: string[],
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${location} must be a non-empty string`);
  }
}

function arrayField(
  record: Record<string, unknown>,
  field: string,
  location: string,
  issues: string[],
): unknown[] {
  return arrayValue(record[field], `${location}.${field}`, issues);
}

function arrayValue(
  value: unknown,
  location: string,
  issues: string[],
): unknown[] {
  if (!Array.isArray(value)) {
    issues.push(`${location} must be an array`);
    return [];
  }
  return value;
}

function exactKeys(
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
  location: string,
  issues: string[],
): void {
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) {
      issues.push(`${location}.${key} is not allowed`);
    }
  }
  for (const key of expectedKeys) {
    if (!(key in record)) {
      issues.push(`${location}.${key} is required`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
