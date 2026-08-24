import type { FunctionalityFeature } from "./types.js";

export interface DocumentationClaimSeed {
  id: string;
  path: string;
  heading: string | null;
  text: string;
}

const TEST_DOCUMENT_PATH = /(?:^|\/)(?:tests?|testing)(?:\/|$)/iu;
const TEST_DOCUMENTATION = /\b(?:test(?:ed|ing|s)?|test suites?|test coverage|unit tests?|integration tests?|security tests?|date utils tests?|pytest|running tests?|run tests?)\b/iu;
const SETUP_DOCUMENTATION = /\b(?:virtual environments?|virtual env|venv|deactivat(?:e|ion)|activat(?:e|ion)|installation instructions?|setup instructions?|development setup|environment setup|getting started)\b/iu;
const INSTRUCTION_HEADING = /\b(?:setup|installation|instructions?|testing|tests?|development environment)\b/iu;
const CHANGELOG_ONLY_DOCUMENTATION =
  /^\s*(?:(?:fix(?:ed|es|ing)?)(?:\s*[:\u2014-]|\s+(?:the|a|an)\b)|cleaned\s+up\b.*\bresponses?\b)/iu;
const IMPLEMENTATION_REPORT_PATH =
  /(?:^|\/)(?:local[-_ ]?docker[-_ ]?development|[^/]*(?:implementation|fix))\.mdx?$/iu;
const MERMAID_DIAGRAM_TEXT =
  /(?:^|\s)(?:sequenceDiagram\b|Note\s+over\b)|->>/iu;
const DESIGN_DOCUMENT_LABEL = /^\s*(?:key methods?|responsibilities)\s*:/iu;
const PSEUDOCODE_CALL_LIST =
  /^(?:\s*[-*+]\s*)?(?:[A-Za-z][A-Za-z0-9_]*\s*\(\s*\)\s*,\s*)+[A-Za-z][A-Za-z0-9_]*\s*\(\s*\)\s*[.]?$/u;
const HISTORICAL_NARRATIVE =
  /\b(?:was experiencing|production[- ]ready)\b/iu;
const NON_PRODUCT_SECTION_HEADING =
  /^(?:discussion(?:\s*\/\s*ask for help)?|ask for help|faq|frequently asked questions|getting help|help and support|support|support channels?|community|contact(?: us)?|contributions?|bug reports?\s*(?:\/|and)\s*feature requests?)$/iu;
const SOCIAL_OR_SUPPORT_CHANNEL_TEXT =
  /\b(?:github issues?|subreddit|community forums?|support channels?|discussion boards?|join (?:our|the) (?:discord|slack|community)|ask (?:on|in|via) (?:discord|github|reddit|slack|stack overflow|the forums?)|open (?:a|an|new) (?:github )?issue|contact (?:us|me)|send (?:us|me) (?:a |an )?email|finding answers? to (?:your|the) questions?|general or technical questions)\b/iu;

/** Contributor/setup/test and support-channel text is retained as a quarantined
 * declared claim, but is never eligible to seed a product feature.
 */
export function isNonProductDocumentationClaim(
  promise: DocumentationClaimSeed,
): boolean {
  const path = promise.path.replaceAll("\\", "/");
  const heading = promise.heading ?? "";
  const content = `${heading}\n${promise.text}`;
  const normalizedHeading = heading
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return TEST_DOCUMENT_PATH.test(path) ||
    IMPLEMENTATION_REPORT_PATH.test(path) ||
    TEST_DOCUMENTATION.test(content) ||
    SETUP_DOCUMENTATION.test(content) ||
    CHANGELOG_ONLY_DOCUMENTATION.test(promise.text) ||
    MERMAID_DIAGRAM_TEXT.test(promise.text) ||
    DESIGN_DOCUMENT_LABEL.test(promise.text) ||
    PSEUDOCODE_CALL_LIST.test(promise.text) ||
    HISTORICAL_NARRATIVE.test(promise.text) ||
    NON_PRODUCT_SECTION_HEADING.test(normalizedHeading) ||
    SOCIAL_OR_SUPPORT_CHANNEL_TEXT.test(promise.text) ||
    (INSTRUCTION_HEADING.test(heading) && /\b(?:run|install|configure|create|activate|deactivate|command)\b/iu.test(
      promise.text,
    ));
}

/** Removes label-pass suffix noise without changing deterministic membership. */
export function normalizeFeatureTitle(title: string): string {
  let normalized = title.trim();
  const noisySuffix = /\s*\((?:duplicate|alternate)(?:\s+\d+)?\)\s*$/iu;
  while (noisySuffix.test(normalized)) {
    normalized = normalized.replace(noisySuffix, "").trim();
  }
  return normalized;
}

export function normalizeFeatureTitles<T extends Pick<FunctionalityFeature, "title">>(
  features: readonly T[],
): T[] {
  return features.map((feature) => ({
    ...feature,
    title: normalizeFeatureTitle(feature.title),
  }));
}
