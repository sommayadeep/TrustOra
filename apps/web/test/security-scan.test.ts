import assert from "node:assert/strict";
import { test } from "node:test";
import { executePaidScanAfterVerification, scanSourceFiles } from "../src/lib/security-scan";

test("paid scanner returns actionable findings from supplied source", () => {
  const result = scanSourceFiles({ "src/a.ts": "const x = eval(input);\nconst key = 'api_key: ' + value;" });
  assert.equal(result.filesScanned, 1);
  assert.equal(result.findings[0]?.ruleId, "JS-EVAL");
  assert.equal(result.findings[0]?.line, 1);
  assert.ok(result.summary.high >= 1);
});

test("paid service cannot execute before Mirror Node verification", () => {
  const input = { "src/a.ts": "eval(input)" };
  assert.equal(executePaidScanAfterVerification("PENDING", input), null);
  assert.equal(executePaidScanAfterVerification("VERIFICATION_PENDING", input), null);
  assert.equal(executePaidScanAfterVerification("VERIFIED", input)?.findings.length, 1);
});
