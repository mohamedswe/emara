import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertContractAccepted,
  ContractAcceptanceError,
  contractIsAccepted,
} from "./contractAcceptance.ts";

test("blocks incomplete contracts from static downstream audits", () => {
  const contract = contractWithAcceptance({
    status: "INCOMPLETE",
    runtimeVerificationPerformed: false,
    failures: ["2 implementation claims are unresolved."],
  });

  assert.equal(contractIsAccepted(contract), false);
  assert.throws(
    () => assertContractAccepted(contract),
    (error) =>
      error instanceof ContractAcceptanceError &&
      /2 implementation claims are unresolved/u.test(error.message),
  );
});

test("allows static contracts for static audits but requires runtime evidence for runtime audits", () => {
  const contract = contractWithAcceptance({
    status: "STATICALLY_VERIFIED",
    runtimeVerificationPerformed: false,
    failures: [],
  });

  assert.equal(contractIsAccepted(contract, "static"), true);
  assert.equal(contractIsAccepted(contract, "runtime"), false);
  assert.throws(
    () => assertContractAccepted(contract, "runtime"),
    /Runtime verification has not been completed/u,
  );
});

test("allows runtime-verified contracts at either acceptance level", () => {
  const contract = contractWithAcceptance({
    status: "RUNTIME_VERIFIED",
    runtimeVerificationPerformed: true,
    failures: [],
  });

  assert.equal(contractIsAccepted(contract, "static"), true);
  assert.equal(contractIsAccepted(contract, "runtime"), true);
});

function contractWithAcceptance(acceptance) {
  return { acceptance };
}
