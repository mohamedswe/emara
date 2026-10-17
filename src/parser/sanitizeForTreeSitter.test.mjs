import assert from "node:assert/strict";
import { test } from "node:test";
import Parser from "tree-sitter";
import Python from "tree-sitter-python";

import { sanitizeForTreeSitter } from "./sanitizeForTreeSitter.ts";

test("sanitized text keeps every UTF-16 offset of the original", () => {
  const input = "# 🚀😀\r\nlabel = '🚀'; helper = 1\n    return '𐐀'\n";
  const output = sanitizeForTreeSitter(input);
  assert.equal(output.length, input.length);
  assert.equal(output.indexOf("helper"), input.indexOf("helper"));
  assert.equal(output, "#     \r\nlabel = '  '; helper = 1\n    return '  '\n");
  assert.doesNotMatch(output, /[\uD800-\uDFFF]/u);
});

test("tree-sitter positions on sanitized text address the same identifier in the original", () => {
  const original = "label = '🚀🚀'; helper = 1\n";
  const parser = new Parser();
  parser.setLanguage(Python);
  const tree = parser.parse(sanitizeForTreeSitter(original));
  const identifiers = tree.rootNode.descendantsOfType("identifier");
  const helper = identifiers.find((node) => node.text === "helper");
  assert.ok(helper);
  assert.equal(original.slice(helper.startIndex, helper.endIndex), "helper");
  assert.equal(helper.startPosition.column, original.indexOf("helper"));
});
