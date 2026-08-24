import type { SoftwareContract } from "./types.js";

export type RequiredContractVerification = "static" | "runtime";

export class ContractAcceptanceError extends Error {
  readonly acceptance: SoftwareContract["acceptance"];

  constructor(
    acceptance: SoftwareContract["acceptance"],
    requiredVerification: RequiredContractVerification = "static",
  ) {
    const failures = acceptance.failures.length === 0
      ? requiredVerification === "runtime"
        ? ["Runtime verification has not been completed."]
        : ["The contract has not passed its acceptance gate."]
      : acceptance.failures;
    super(
      `Software contract is not accepted for ${requiredVerification} audits: ${failures.join(" ")}`,
    );
    this.name = "ContractAcceptanceError";
    this.acceptance = acceptance;
  }
}

export function contractIsAccepted(
  contract: SoftwareContract,
  requiredVerification: RequiredContractVerification = "static",
): boolean {
  if (contract.acceptance.status === "INCOMPLETE") return false;
  return requiredVerification === "static" ||
    contract.acceptance.status === "RUNTIME_VERIFIED";
}

export function assertContractAccepted(
  contract: SoftwareContract,
  requiredVerification: RequiredContractVerification = "static",
): void {
  if (!contractIsAccepted(contract, requiredVerification)) {
    throw new ContractAcceptanceError(
      contract.acceptance,
      requiredVerification,
    );
  }
}
