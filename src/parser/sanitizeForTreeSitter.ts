/**
 * tree-sitter's JS binding throws EINVAL ("Invalid argument") on astral-plane
 * characters (emoji, flags, etc.). Replace each one with two spaces: an astral
 * character is two UTF-16 code units, so every index, line and column in the
 * sanitized text still addresses the same position in the original text.
 * Identifiers the analyzers care about are ASCII.
 */
export function sanitizeForTreeSitter(source: string): string {
  return source.replace(/[^\u0000-\uFFFF]/gu, "  ");
}
