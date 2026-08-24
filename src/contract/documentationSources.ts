const NON_PRODUCT_DOCUMENT_BASENAME =
  /^(?:agents?|claude|gemini|copilot[-_]instructions|code[-_]of[-_]conduct|contributing|security|support|governance|maintainers?|authors?|community|funding|pull[-_]request[-_]template)(?:[._-][a-z0-9]+)*\.(?:md|mdx)$/iu;
const COMMUNITY_TEMPLATE_PATH =
  /(?:^|\/)\.(?:github|gitlab)\/(?:discussion_template|issue_template|merge_request_templates?|pull_request_template)(?:\/|$)/iu;
const README_SOURCE_PATH = /(?:^|\/)readme(?:\.[a-z0-9_-]+)*\.mdx?$/iu;
const DOCS_SOURCE_PATH = /(?:^|\/)docs\/.*\.(?:md|mdx)$/iu;
const EXPLICIT_PRODUCT_CLAIM_SOURCE_PATH =
  /(?:^|\/)(?:capabilities|features?|product(?:[-_]claims?)?|requirements?|specification)\.(?:md|mdx)$/iu;
const SUPPLEMENTAL_SUMMARY_SOURCE_PATH =
  /(?:^|\/)[^/]*summary\.mdx?$/iu;
const PRODUCT_COPY_SOURCE_PATH =
  /(?:^|\/)(?:featurespage|languagecontext)\.[cm]?[jt]sx?$/iu;

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

/** Agent instructions and community-governance files are not product docs. */
export function isNonProductDocumentationSourcePath(path: string): boolean {
  const normalized = normalizedPath(path);
  const basename = normalized.split("/").at(-1) ?? "";
  return NON_PRODUCT_DOCUMENT_BASENAME.test(basename) ||
    COMMUNITY_TEMPLATE_PATH.test(normalized);
}

/** Source files whose literal product copy is an explicit claim input. */
export function isProductCopySourcePath(path: string): boolean {
  return PRODUCT_COPY_SOURCE_PATH.test(normalizedPath(path));
}

/** Explicit summary artifacts retain their existing bounded claim treatment. */
export function isSupplementalSummarySourcePath(path: string): boolean {
  return SUPPLEMENTAL_SUMMARY_SOURCE_PATH.test(normalizedPath(path)) &&
    !isNonProductDocumentationSourcePath(path);
}

/** Named claim artifacts may opt in even when the coverage pass calls them unknown. */
export function isExplicitProductClaimSourcePath(path: string): boolean {
  return EXPLICIT_PRODUCT_CLAIM_SOURCE_PATH.test(normalizedPath(path)) &&
    !isNonProductDocumentationSourcePath(path);
}

/**
 * Product documentation is deliberately whitelisted. A community filename
 * always wins over its directory, including when it appears below docs/.
 */
export function isProductDocumentationSourcePath(path: string): boolean {
  const normalized = normalizedPath(path);
  if (isNonProductDocumentationSourcePath(normalized)) return false;
  return README_SOURCE_PATH.test(normalized) ||
    DOCS_SOURCE_PATH.test(normalized) ||
    isExplicitProductClaimSourcePath(normalized) ||
    isSupplementalSummarySourcePath(normalized) ||
    isProductCopySourcePath(normalized);
}

/** Markdown product docs handled by the ordinary paragraph extractor. */
export function isPrimaryProductDocumentationSourcePath(path: string): boolean {
  return isProductDocumentationSourcePath(path) &&
    !isSupplementalSummarySourcePath(path) &&
    !isProductCopySourcePath(path);
}
