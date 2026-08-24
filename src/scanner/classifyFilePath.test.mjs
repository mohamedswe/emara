import assert from "node:assert/strict";
import { test } from "node:test";

import { isTestFilePath } from "./classifyFilePath.ts";

test("recognizes established test conventions across supported ecosystems", () => {
  for (const path of [
    "src/__tests__/widget.ts",
    "tests/integration/api.py",
    "backend/test_chat_quality.py",
    "backend/chat_quality_test.py",
    "pkg/server_test.go",
    "spec/models/user_spec.rb",
    "src/UserServiceTest.java",
    "src/UserServiceTests.cs",
    "src/parser_test.rs",
    "scripts/check.bats",
  ]) {
    assert.equal(isTestFilePath(path), true, path);
  }
});

test("does not classify incidental test substrings as test files", () => {
  for (const path of [
    "backend/contest.py",
    "backend/latest.py",
    "src/testingTools.ts",
    "src/attestation.ts",
    "src/UserService.java",
    "src/Contest.java",
  ]) {
    assert.equal(isTestFilePath(path), false, path);
  }
});
