import { test } from "node:test";
import assert from "node:assert/strict";
import { configuredHederaServices } from "../src/lib/hedera";
import { paymentRequirementsForService } from "../../../packages/hedera/src/index";

const NAMES = ["HEDERA_SERVICE_RECIPIENT", "HEDERA_FACILITATOR_ACCOUNT_ID"] as const;

function withEnv(values: Partial<Record<(typeof NAMES)[number], string>>, body: () => void): void {
  const saved = NAMES.map((name) => [name, process.env[name]] as const);
  try {
    for (const name of NAMES) {
      const value = values[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("the configured service names the facilitator account as its fee payer", () => {
  withEnv({ HEDERA_SERVICE_RECIPIENT: "0.0.1003", HEDERA_FACILITATOR_ACCOUNT_ID: " 0.0.1002 " }, () => {
    const service = configuredHederaServices().get("security-scan");
    assert.ok(service);
    assert.equal(paymentRequirementsForService(service).extra.feePayer, "0.0.1002");
  });
});

test("no fee payer is advertised from a missing or malformed facilitator account", () => {
  for (const facilitator of [undefined, "", "0xabc"]) {
    withEnv({ HEDERA_SERVICE_RECIPIENT: "0.0.1003", HEDERA_FACILITATOR_ACCOUNT_ID: facilitator }, () => {
      const service = configuredHederaServices().get("security-scan");
      assert.ok(service);
      assert.equal("feePayer" in paymentRequirementsForService(service).extra, false);
    });
  }
});
