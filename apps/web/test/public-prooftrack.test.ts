import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPublicProjectEvidence, isHederaTx, publicStatus, validPublicTransactionReference } from "../src/lib/public-prooftrack";

const projectFixture = (overrides: Record<string, unknown> = {}) => ({
  id: "TRU-PROJ-2026-0001042", status: "IN_PROGRESS", registerTxHash: `0x${"1".repeat(64)}`, createdAt: new Date("2026-11-01T00:00:00Z"),
  milestones: [{
    milestoneIndex: 1, state: "SUBMITTED", addTxHash: `0x${"2".repeat(64)}`, fundingTxHash: `0x${"3".repeat(64)}`, releaseTxHash: null,
    fundedAt: new Date("2026-11-01T01:00:00Z"), releasedAt: null,
    submissions: [{ version: 1, anchorTxHash: `0x${"4".repeat(64)}`, submittedAt: new Date("2026-11-01T02:00:00Z"), evaluations: [{
      overallVerdict: "PARTIAL", inferenceRequestId: "provider-request-456", requestIdSource: "x_0g_trace.request_id", teeVerified: true,
      teeVerifiedBy: "router-reported", modelId: "glm-test", reportHash: "a".repeat(64), createdAt: new Date("2026-11-01T03:00:00Z"),
    }] }],
  }],
  proofTrackEvents: [
    { ecosystem: "ARC", eventType: "ESCROW_FUNDED", referenceType: "BLOCKCHAIN_TRANSACTION_HASH", referenceValue: `0x${"3".repeat(64)}`, verificationStatus: "VERIFIED", timestamp: new Date("2026-11-01T01:00:00Z") },
    { ecosystem: "ZERO_G", eventType: "0G_EVALUATION_COMPLETED", referenceType: "INFERENCE_REQUEST_ID", referenceValue: "provider-request-456", verificationStatus: "PENDING", timestamp: new Date("2026-11-01T03:00:00Z") },
  ],
  ...overrides,
} as any);

test("public projection includes ARC, 0G and Hedera evidence with precise verification labels", () => {
  const result = buildPublicProjectEvidence(projectFixture(), [{
    id: "pay-record-1", serviceName: "Security Scan", providerAccount: "0.0.482910", amountTinybars: "10000000",
    txId: "0.0.7@1700000000.000000000", status: "VERIFIED", createdAt: new Date("2026-11-01T04:00:00Z"),
    serviceResultJson: JSON.stringify({ filesScanned: 2, findings: [{ file: "secret/path.ts" }], summary: { high: 1, medium: 0 } }),
  }]);
  assert.equal(result.evidence.arc.find((entry) => entry.label === "Milestone funding")?.verificationStatus, "VERIFIED");
  assert.deepEqual(result.evidence.zeroG[0]?.tee, { claim: true, source: "provider-reported", status: "PENDING" });
  assert.equal(result.evidence.zeroG[0]?.requestId, "provider-request-456");
  assert.equal(result.evidence.hedera[0]?.verificationStatus, "VERIFIED");
  assert.deepEqual(result.evidence.hedera[0]?.scan, { filesScanned: 2, high: 1, medium: 0 });
  const json = JSON.stringify(result);
  assert.equal(json.includes("secret/path.ts"), false);
  assert.equal(json.includes("walletAddress"), false);
  assert.ok(result.timeline[0]!.timestamp >= result.timeline.at(-1)!.timestamp);
});

test("missing evidence is explicit and never upgraded to verified", () => {
  const result = buildPublicProjectEvidence(projectFixture({ registerTxHash: null, milestones: [], proofTrackEvents: [] }), []);
  assert.equal(result.evidence.arc[0]?.verificationStatus, "UNVERIFIED");
  assert.deepEqual(result.evidence.zeroG, []);
  assert.deepEqual(result.evidence.hedera, []);
  assert.deepEqual(result.timeline.map((entry) => entry.status), ["UNVERIFIED"]);
});

test("invalid references are rejected or omitted and failed verification stays failed", () => {
  assert.equal(validPublicTransactionReference("not-a-tx"), false);
  assert.equal(isHederaTx("0.0.7@not-a-time"), false);
  assert.equal(publicStatus("FACILITATOR_SAYS_OK"), "UNVERIFIED");
  const invalid = buildPublicProjectEvidence(projectFixture({ registerTxHash: "made-up", milestones: [{
    milestoneIndex: 1, state: "FAILED", addTxHash: null, fundingTxHash: null, releaseTxHash: null, fundedAt: null, releasedAt: null,
    submissions: [{ version: 1, anchorTxHash: null, submittedAt: new Date(), evaluations: [{ overallVerdict: "FAIL", inferenceRequestId: "bad id/secret", requestIdSource: "router-reported", teeVerified: false, teeVerifiedBy: "sdk-independent", modelId: null, reportHash: "invalid", createdAt: new Date() }] }],
  }] }), [{ id: "pay-failed", serviceName: "Scan", providerAccount: "0.0.7", amountTinybars: "100", txId: null, status: "FAILED_EXECUTION", createdAt: new Date(), serviceResultJson: null }]);
  assert.equal(invalid.evidence.arc.some((entry) => entry.txId === "made-up"), false);
  assert.equal(invalid.evidence.zeroG[0]?.requestId, null);
  assert.equal(invalid.evidence.zeroG[0]?.reportHash, null);
  assert.equal(invalid.evidence.zeroG[0]?.tee.status, "FAILED");
  assert.equal(invalid.evidence.hedera[0]?.verificationStatus, "FAILED");
});

test("failed ARC and Hedera verification records remain FAILED with their genuine references", () => {
  const failedArcTx = `0x${"9".repeat(64)}`;
  const project = projectFixture({
    registerTxHash: failedArcTx,
    proofTrackEvents: [{ ecosystem: "ARC", eventType: "ESCROW_REGISTER_FAILED", referenceType: "BLOCKCHAIN_TRANSACTION_HASH", referenceValue: failedArcTx, verificationStatus: "FAILED", timestamp: new Date() }],
  });
  const result = buildPublicProjectEvidence(project, [{
    id: "pay-failed-with-tx", serviceName: "Scan", providerAccount: "0.0.7", amountTinybars: "100", txId: "0.0.7@1700000000.000000000",
    status: "FAILED_EXECUTION", createdAt: new Date(), serviceResultJson: null,
  }]);
  assert.equal(result.evidence.arc[0]?.verificationStatus, "FAILED");
  assert.equal(result.evidence.hedera[0]?.verificationStatus, "FAILED");
  assert.ok(result.evidence.hedera[0]?.transactionId);
});

test("legacy facilitator settlement is UNVERIFIED without a Mirror Node-confirmed status", () => {
  const result = buildPublicProjectEvidence(projectFixture(), [{
    id: "pay-legacy", serviceName: "Legacy", providerAccount: "0.0.7", amountTinybars: "100", txId: "0.0.7@1700000000.000000000",
    status: "SETTLED", createdAt: new Date(), serviceResultJson: null,
  }]);
  assert.equal(result.evidence.hedera[0]?.verificationStatus, "UNVERIFIED");
});
