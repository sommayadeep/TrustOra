import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HBAR_ASSET,
  HEDERA_TESTNET,
  StaticX402ServiceRegistry,
  evaluateX402Policy,
  matchesX402Requirements,
  parseHederaPrivateKey,
  paymentRequirementsForService,
  prepareHederaX402Payment,
  settleAndVerifyX402Payment,
} from "../src/x402";
import { PrivateKey } from "@x402/hedera";
import type { HederaSettlementVerifier } from "../src/verifier";

const service = {
  id: "security-scan",
  name: "TRUSTORA Security Scan",
  endpoint: "https://scan.trustora.network/api",
  recipient: "0.0.482910",
  amountTinybars: "10000000",
  network: HEDERA_TESTNET,
  asset: HBAR_ASSET,
  description: "Test service",
} as const;

test("service discovery is deterministic and does not fabricate services", () => {
  const registry = new StaticX402ServiceRegistry([service]);
  assert.deepEqual(registry.discover(), [service]);
  assert.deepEqual(registry.get("missing"), null);
});

test("x402 requirements preserve exact Hedera tinybars", () => {
  assert.deepEqual(paymentRequirementsForService(service), {
    scheme: "exact",
    network: "hedera:testnet",
    asset: "0.0.0",
    amount: "10000000",
    payTo: "0.0.482910",
    maxTimeoutSeconds: 300,
    extra: { resourceId: "security-scan" },
  });
});

test("payer-signed x402 terms must exactly match the discovered service offer", () => {
  const expected = paymentRequirementsForService(service);
  assert.equal(matchesX402Requirements(expected, expected), true);
  for (const changed of [
    { ...expected, scheme: "upto" },
    { ...expected, network: "hedera:mainnet" },
    { ...expected, asset: "0.0.123" },
    { ...expected, amount: "150000001" },
    { ...expected, payTo: "0.0.999999" },
    { ...expected, maxTimeoutSeconds: 900 },
    { ...expected, extra: { resourceId: "different-service" } },
  ]) {
    assert.equal(matchesX402Requirements(changed, expected), false);
  }
});

test("policy permits an allowlisted Hedera testnet service", () => {
  const result = evaluateX402Policy(undefined, paymentRequirementsForService(service), "scan.trustora.network");
  assert.deepEqual(result, { allowed: true });
});

test("policy rejects an unallowlisted service before facilitator use", () => {
  const requirements = paymentRequirementsForService({ ...service, recipient: "0.0.999999" });
  const result = evaluateX402Policy(undefined, requirements, "untrusted.example");
  assert.equal(result.allowed, false);
  assert.match(result.reason ?? "", /not allowlisted/);
});

test("official Hedera client flow signs only a matching allowlisted challenge within remaining budget", async () => {
  const expected = paymentRequirementsForService(service);
  let signed = 0;
  const prepared = await prepareHederaX402Payment({
    agent: {
      accountId: "0.0.7",
      http: { encodePaymentSignatureHeader: () => ({ "PAYMENT-SIGNATURE": "mock-payload" }) },
      createPaymentPayload: async () => { signed++; return { x402Version: 2 } as any; },
    } as any,
    service: { ...service, endpoint: "https://scan.trustora.network/api" },
    paymentRequired: { x402Version: 2, accepts: [expected] } as any,
    remainingDailyTinybars: 10_000_000n,
  });
  assert.equal(signed, 1);
  assert.equal(prepared.requirements.payTo, service.recipient);
  assert.deepEqual(prepared.paymentSignatureHeader, { "PAYMENT-SIGNATURE": "mock-payload" });
});

test("official Hedera client refuses altered network, asset, recipient and amount before signing", async () => {
  const expected = paymentRequirementsForService(service);
  for (const changed of [
    { ...expected, network: "hedera:mainnet" },
    { ...expected, asset: "0.0.123" },
    { ...expected, payTo: "0.0.999999" },
    { ...expected, amount: "100000001" },
  ]) {
    let signed = false;
    await assert.rejects(() => prepareHederaX402Payment({
      agent: { accountId: "0.0.7", http: {}, createPaymentPayload: async () => { signed = true; return {} as any; } } as any,
      service: { ...service, endpoint: "https://scan.trustora.network/api" },
      paymentRequired: { x402Version: 2, accepts: [changed] } as any,
      remainingDailyTinybars: 100_000_000n,
    }));
    assert.equal(signed, false);
  }
});

test("official Hedera client rejects insufficient rolling budget before signing", async () => {
  let signed = false;
  await assert.rejects(() => prepareHederaX402Payment({
    agent: { accountId: "0.0.7", http: {}, createPaymentPayload: async () => { signed = true; return {} as any; } } as any,
    service: { ...service, endpoint: "https://scan.trustora.network/api" },
    paymentRequired: { x402Version: 2, accepts: [paymentRequirementsForService(service)] } as any,
    remainingDailyTinybars: 9_999_999n,
  }), /INSUFFICIENT_DAILY_BUDGET/);
  assert.equal(signed, false);
});

test("facilitator settlement stays pending until the mocked Mirror Node confirms exact transfer", async () => {
  const requirements = paymentRequirementsForService(service);
  let settlements = 0;
  const facilitator = {
    verify: async () => ({ isValid: true, payer: "0.0.7" }),
    settle: async () => { settlements++; return { success: true, transaction: "0.0.7@1700000000.000000000" }; },
  } as any;
  const pending = await settleAndVerifyX402Payment({
    facilitator, payload: {} as any, requirements,
    verifier: { check: async () => ({ status: "NOT_FOUND_YET", reason: "mock mirror lag" }) } as unknown as HederaSettlementVerifier,
  });
  assert.equal(pending.status, "VERIFICATION_PENDING");
  assert.equal(settlements, 1);
  const verified = await settleAndVerifyX402Payment({
    facilitator, payload: {} as any, requirements,
    verifier: { check: async () => ({ status: "VERIFIED", consensusTimestamp: "1700000000.000000000", mirrorTransactionId: "0.0.7-1700000000-000000000" }) } as unknown as HederaSettlementVerifier,
  });
  assert.equal(verified.status, "VERIFIED");
});

test("facilitator rejection and failed settlement never reach Mirror Node verification", async () => {
  let mirrorCalls = 0;
  const verifier = { check: async () => { mirrorCalls++; return { status: "VERIFIED", consensusTimestamp: "x", mirrorTransactionId: "x" }; } } as unknown as HederaSettlementVerifier;
  const requirements = paymentRequirementsForService(service);
  const rejected = await settleAndVerifyX402Payment({ facilitator: { verify: async () => ({ isValid: false, invalidReason: "bad signature" }), settle: async () => { throw new Error("must not settle"); } } as any, payload: {} as any, requirements, verifier });
  assert.equal(rejected.status, "REJECTED_POLICY");
  const failed = await settleAndVerifyX402Payment({ facilitator: { verify: async () => ({ isValid: true, payer: "0.0.7" }), settle: async () => ({ success: false, errorReason: "mock failure" }) } as any, payload: {} as any, requirements, verifier });
  assert.equal(failed.status, "FAILED_EXECUTION");
  assert.equal(mirrorCalls, 0);
});

test("a Mirror Node on-chain failure remains failed and cannot claim verification", async () => {
  const result = await settleAndVerifyX402Payment({
    facilitator: {
      verify: async () => ({ isValid: true, payer: "0.0.7" }),
      settle: async () => ({ success: true, transaction: "0.0.7@1700000000.000000000" }),
    } as any,
    payload: {} as any,
    requirements: paymentRequirementsForService(service),
    verifier: { check: async () => ({ status: "FAILED_ON_CHAIN", reason: "mock reverted transaction" }) } as unknown as HederaSettlementVerifier,
  });
  assert.equal(result.status, "FAILED_EXECUTION");
  assert.equal(result.verification?.status, "FAILED_ON_CHAIN");
});

test("the facilitator account is offered as extra.feePayer, which the Hedera client scheme requires", () => {
  const requirements = paymentRequirementsForService({ ...service, feePayer: "0.0.777" });
  assert.deepEqual(requirements.extra, { resourceId: "security-scan", feePayer: "0.0.777" });
});

test("a payer-signed offer naming a different fee payer does not match", () => {
  const expected = paymentRequirementsForService({ ...service, feePayer: "0.0.777" });
  assert.equal(matchesX402Requirements(expected, expected), true);
  assert.equal(
    matchesX402Requirements({ ...expected, extra: { resourceId: "security-scan", feePayer: "0.0.778" } }, expected),
    false,
  );
  assert.equal(matchesX402Requirements({ ...expected, extra: { resourceId: "security-scan" } }, expected), false);
});

// Well-known-shape fixtures only. These are not real keys and nothing here signs anything.
const RAW_HEX = "11".repeat(32);

test("a 0x-prefixed raw hex key is parsed as ECDSA, not the SDK's ED25519 default", () => {
  assert.equal(parseHederaPrivateKey(`0x${RAW_HEX}`).type, "secp256k1");
});

test("an unprefixed raw hex key keeps the SDK's ED25519 interpretation", () => {
  assert.equal(parseHederaPrivateKey(RAW_HEX).type, "ED25519");
});

test("DER keys keep the algorithm they encode", () => {
  const ecdsaDer = PrivateKey.fromStringECDSA(RAW_HEX).toStringDer();
  const ed25519Der = PrivateKey.fromStringED25519(RAW_HEX).toStringDer();
  assert.equal(parseHederaPrivateKey(ecdsaDer).type, "secp256k1");
  assert.equal(parseHederaPrivateKey(ed25519Der).type, "ED25519");
});

test("surrounding whitespace is ignored", () => {
  assert.equal(parseHederaPrivateKey(`  0x${RAW_HEX}\n`).type, "secp256k1");
});

test("an unusable key is refused without echoing it", () => {
  const sentinel = "NEVER-EMIT-THIS-SENTINEL-KEY-0000";
  for (const bad of [sentinel, "", `0x${"zz".repeat(32)}`, `0x${"11".repeat(16)}`, "11".repeat(16)]) {
    assert.throws(
      () => parseHederaPrivateKey(bad),
      (err: Error) => /INVALID_HEDERA_PRIVATE_KEY_FORMAT/.test(err.message) && !err.message.includes(sentinel),
    );
  }
});
