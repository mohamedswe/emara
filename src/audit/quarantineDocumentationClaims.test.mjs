import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isNonProductDocumentationClaim,
  normalizeFeatureTitle,
  normalizeFeatureTitles,
} from "./quarantineDocumentationClaims.ts";

test("quarantines setup and test documentation without hiding product promises", () => {
  const claims = [
    claim("venv", "README.md", "Setup", "To deactivate the virtual environment, type deactivate."),
    claim("security-tests", "backend/tests/README.md", "Security Tests", "Authentication and authorization."),
    claim("suite", "README.md", "Testing", "Run the comprehensive backend test suite."),
    claim("date-utils", "README.md", "Date Utils Tests", "Serialization, parsing, and formatting."),
    claim("vite-fix", "README.md", "Commits", "Fixed the vite.config file."),
    claim("bug-fix", "README.md", "Commits", "Fixed the bug in package.json."),
    claim("response-cleanup", "README.md", "Auth", "Cleaned up POST /auth/login responses."),
    claim(
      "support-channels",
      "README.md",
      "🗣️ Discussion / Ask for Help",
      "I recommend using Google, GitHub Issues, or Uptime Kuma's subreddit for finding answers to your question.",
    ),
    claim(
      "discord",
      "README.md",
      null,
      "Join our Discord community or open a GitHub issue if you need help.",
    ),
    claim("product", "README.md", "Features", "Manage rental cars and clients."),
    claim("auth-pages", "README.md", "Auth", "Added GET /auth/login and GET /auth/register pages."),
    claim(
      "notifications",
      "README.md",
      "Features",
      "Send service notifications via Discord and Slack.",
    ),
    claim(
      "implementation-report",
      "docs/MULTI_CURRENCY_IMPLEMENTATION.md",
      "What Was Implemented",
      "Your payment system now supports eight currencies.",
    ),
    claim(
      "race-condition-fix",
      "backend/docs/WEBHOOK_RACE_CONDITION_FIX.md",
      "Problem Summary",
      "The platform was experiencing critical webhook race conditions.",
    ),
    claim(
      "production-ready",
      "docs/design.md",
      "Conclusion",
      "The fix is production-ready and scalable.",
    ),
    claim(
      "diagram",
      "docs/backend-logic.md",
      "Authentication Flow",
      "Note over C,JWT: Token Refresh C->>API: POST /auth/refresh",
    ),
    claim(
      "responsibilities",
      "docs/backend-logic.md",
      "Service Architecture",
      "Responsibilities: User authentication, JWT management, OAuth integration",
    ),
    claim(
      "pseudocode",
      "docs/backend-logic.md",
      "Service Architecture",
      "authenticate_user(), createAccessToken(), verifyToken()",
    ),
  ];

  assert.deepEqual(
    claims.filter(isNonProductDocumentationClaim).map((value) => value.id),
    [
      "venv",
      "security-tests",
      "suite",
      "date-utils",
      "vite-fix",
      "bug-fix",
      "response-cleanup",
      "support-channels",
      "discord",
      "implementation-report",
      "race-condition-fix",
      "production-ready",
      "diagram",
      "responsibilities",
      "pseudocode",
    ],
  );
});

test("removes duplicate and alternate title suffixes deterministically", () => {
  assert.equal(normalizeFeatureTitle("Get Car (Duplicate)"), "Get Car");
  assert.equal(normalizeFeatureTitle("Get Car (Alternate 2)"), "Get Car");
  assert.equal(normalizeFeatureTitle("Get Car (Duplicate 12)"), "Get Car");
  assert.equal(
    normalizeFeatureTitle("Get Car (Alternate 2) (Duplicate)"),
    "Get Car",
  );
  assert.deepEqual(
    normalizeFeatureTitles([{ title: "Root (Alternate)", id: "root" }]),
    [{ title: "Root", id: "root" }],
  );
});

function claim(id, path, heading, text) {
  return { id, path, heading, text };
}
