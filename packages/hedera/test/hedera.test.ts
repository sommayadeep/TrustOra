import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  AgentPolicyEngine,
  DEFAULT_HEDERA_POLICY,
  HederaAgentPayer,
  HederaSettlementVerifier,
  X402Challenge,
} from "../src/index";

describe("Hedera x402 Agent Payments Suite", () => {
  const validChallenge: X402Challenge = {
    scheme: "exact",
    network: "hedera:testnet",
    asset: "0.0.0",
    recipient: "0.0.482910",
    amountHbar: 0.5,
    resourceId: "code-audit-service",
  };

  describe("x402 Header Parser", () => {
    const payer = new HederaAgentPayer();

    test("successfully parses standard x402 authenticate header", () => {
      const header = 'x402 scheme="exact", network="hedera:testnet", asset="0.0.0", recipient="0.0.482910", amount="1.75", resource="sec-scan-01"';
      const parsed = payer.parseX402Header(header);
      assert.notEqual(parsed, null);
      assert.equal(parsed?.scheme, "exact");
      assert.equal(parsed?.network, "hedera:testnet");
      assert.equal(parsed?.asset, "0.0.0");
      assert.equal(parsed?.recipient, "0.0.482910");
      assert.equal(parsed?.amountHbar, 1.75);
      assert.equal(parsed?.resourceId, "sec-scan-01");
    });

    test("rejects malformed header", () => {
      assert.equal(payer.parseX402Header("Bearer token123"), null);
      assert.equal(payer.parseX402Header(""), null);
    });
  });

  describe("Agent Policy Engine & Spending Limits", () => {
    test("approves valid request within policy boundaries", () => {
      const engine = new AgentPolicyEngine();
      const res = engine.evaluateChallenge(validChallenge, "audit.trustora.network");
      assert.equal(res.allowed, true);
    });

    test("rejects non-allowlisted provider or recipient", () => {
      const engine = new AgentPolicyEngine();
      const res = engine.evaluateChallenge(
        { ...validChallenge, recipient: "0.0.999999" },
        "malicious-third-party.com"
      );
      assert.equal(res.allowed, false);
      assert.match(res.reason || "", /not allowlisted/);
    });

    test("rejects unsupported network (e.g. mainnet or unauthorized chain)", () => {
      const engine = new AgentPolicyEngine();
      const res = engine.evaluateChallenge(
        { ...validChallenge, network: "hedera:mainnet" },
        "audit.trustora.network"
      );
      assert.equal(res.allowed, false);
      assert.match(res.reason || "", /Network "hedera:mainnet" not in allowed list/);
    });

    test("rejects unauthorized asset (non-HBAR)", () => {
      const engine = new AgentPolicyEngine();
      const res = engine.evaluateChallenge(
        { ...validChallenge, asset: "0.0.999" },
        "audit.trustora.network"
      );
      assert.equal(res.allowed, false);
      assert.match(res.reason || "", /Asset "0.0.999" is not native HBAR/);
    });

    test("enforces per-transaction payment cap (max 1 HBAR)", () => {
      const engine = new AgentPolicyEngine();
      const res = engine.evaluateChallenge(
        { ...validChallenge, amountHbar: 1.1 },
        "audit.trustora.network"
      );
      assert.equal(res.allowed, false);
      assert.match(res.reason || "", /exceeds maximum per-transaction cap/);
    });

    test("enforces daily cumulative budget ceiling (max 5 HBAR)", () => {
      const engine = new AgentPolicyEngine();
      // Record valid payments totaling 4.5 HBAR.
      for (const amount of [1, 1, 1, 1, 0.5]) {
        engine.recordSpend(amount);
      }
      assert.equal(engine.getDailySpend(), 4.5);

      // The next valid-sized payment would exceed the 5 HBAR daily limit.
      const res = engine.evaluateChallenge(
        { ...validChallenge, amountHbar: 0.6 },
        "audit.trustora.network"
      );
      assert.equal(res.allowed, false);
      assert.match(res.reason || "", /exceed daily budget ceiling/);
    });

    test("custom config cannot raise the reviewed payment or daily caps", () => {
      const engine = new AgentPolicyEngine({ maxPaymentTinybars: 9_000_000_000n, maxDailyBudgetTinybars: 90_000_000_000n });
      assert.equal(engine.getPolicy().maxPaymentTinybars, 100_000_000n);
      assert.equal(engine.getPolicy().maxDailyBudgetTinybars, 500_000_000n);
      assert.equal(engine.evaluateChallenge({ ...validChallenge, amountHbar: 1.01 }, "audit.trustora.network").allowed, false);
    });
  });

  describe("Agent Payment Coordinator Execution", () => {
    test("truthfully returns NOT_CONFIGURED when agent keys missing (never fabricates hashes)", async () => {
      const unconfiguredPayer = new HederaAgentPayer({ accountId: undefined, privateKey: undefined });
      const result = await unconfiguredPayer.executeAutonomousPayment(
        validChallenge,
        "audit.trustora.network"
      );
      assert.equal(result.status, "NOT_CONFIGURED");
      assert.equal(result.txId, null);
      assert.equal(result.hashscanUrl, null);
      assert.equal(result.auditLog.some((e) => e.step === "WALLET_CONFIGURATION_CHECK"), true);
    });

    test("does not fabricate a settlement when only keys are configured", async () => {
      const configuredPayer = new HederaAgentPayer({
        accountId: "0.0.1001",
        privateKey: "302e020100300506032b657004220420...",
      });
      const result = await configuredPayer.executeAutonomousPayment(
        validChallenge,
        "audit.trustora.network"
      );
      assert.equal(result.status, "NOT_CONFIGURED");
      assert.equal(result.txId, null);
      assert.equal(result.hashscanUrl, null);
      assert.equal(result.auditLog.length >= 3, true);
    });
  });

  describe("Settlement Verifier & HashScan Links", () => {
    const verifier = new HederaSettlementVerifier();

    test("generates correct HashScan URL for transaction ID", () => {
      const url = verifier.getHashScanUrl("0.0.1001@1700000000.000000000");
      assert.equal(url, "https://hashscan.io/testnet/transaction/0.0.1001%401700000000.000000000");
    });

    test("safely fails on missing transaction ID", async () => {
      const verification = await verifier.verifySettlement("", "0.0.482910", 1.0);
      assert.equal(verification.isVerified, false);
      assert.equal(verification.error, "MISSING_TX_ID");
    });
  });
});
