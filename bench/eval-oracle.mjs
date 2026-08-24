import { readFileSync } from "node:fs";
import { evaluateAuditAgainstOracle } from "../src/audit/oracle.ts";

const audit = JSON.parse(readFileSync(process.argv[2], "utf8"));
const oracle = JSON.parse(readFileSync(process.argv[3], "utf8"));
const result = evaluateAuditAgainstOracle(audit, oracle);
console.log(result.passed ? "ORACLE: PASS" : "ORACLE: FAIL");
for (const failure of result.failures) console.log("  - " + failure);
