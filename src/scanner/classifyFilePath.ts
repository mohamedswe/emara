/**
 * Returns true only for established test-file and test-directory conventions.
 *
 * Keep this path-based and language-agnostic: graph construction, reachability,
 * evidence hydration, and coverage review must agree about whether a file is a
 * test. Avoid substring matching so production files such as `contest.py` and
 * `latest.ts` are not mislabeled.
 */
export function isTestFilePath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const baseName = segments.at(-1) ?? normalized;
  const lowerBaseName = baseName.toLowerCase();

  if (
    lowerSegments.slice(0, -1).some((segment) =>
      segment === "test" ||
      segment === "tests" ||
      segment === "__tests__" ||
      segment === "spec" ||
      segment === "specs" ||
      segment === "__snapshots__"
    )
  ) {
    return true;
  }

  return (
    /\.(?:test|spec)\.[^.]+$/u.test(lowerBaseName) ||
    /^(?:test_.+|.+_test)\.py$/u.test(lowerBaseName) ||
    /^conftest\.py$/u.test(lowerBaseName) ||
    /_test\.go$/u.test(lowerBaseName) ||
    /^(?:test_.+|.+_spec)\.rb$/u.test(lowerBaseName) ||
    /(?:Test|Tests|TestCase)\.(?:java|kt|kts|cs|php)$/u.test(baseName) ||
    /_test\.rs$/u.test(lowerBaseName) ||
    /\.bats$/u.test(lowerBaseName)
  );
}
