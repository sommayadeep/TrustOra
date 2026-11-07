/**
 * @file policy.ts
 * @description Policy engine for bounded autonomous agent payments on Hedera.
 */

import { HederaPaymentPolicy, X402Challenge } from "./types";
import { formatTinybars, MAX_DAILY_TINYBARS, MAX_PAYMENT_TINYBARS, parseHbarToTinybars } from "./units";

export const DEFAULT_HEDERA_POLICY: HederaPaymentPolicy = {
  maxPaymentTinybars: MAX_PAYMENT_TINYBARS,
  maxDailyBudgetTinybars: MAX_DAILY_TINYBARS,
  allowedProviders: [
    "0.0.482910",              // Official Trustora Code Auditor Testnet Account
    "0.0.482911",              // Official Trustora Security Scanner Testnet Account
    "audit.trustora.network",
    "scan.trustora.network",
    "verify.integratenetwork.work"
  ],
  allowedNetworks: ["hedera:testnet"],
  allowedAssets: ["0.0.0"],   // Native HBAR
};

export class AgentPolicyEngine {
  private policy: HederaPaymentPolicy;
  private dailySpendTracker: Map<string, bigint> = new Map();

  constructor(customPolicy?: Partial<HederaPaymentPolicy>) {
    this.policy = { ...DEFAULT_HEDERA_POLICY, ...customPolicy };
    // Local/service configuration may tighten these caps, never raise the reviewed defaults.
    if (this.policy.maxPaymentTinybars > MAX_PAYMENT_TINYBARS) this.policy.maxPaymentTinybars = MAX_PAYMENT_TINYBARS;
    if (this.policy.maxDailyBudgetTinybars > MAX_DAILY_TINYBARS) this.policy.maxDailyBudgetTinybars = MAX_DAILY_TINYBARS;
  }

  /**
   * Evaluates an x402 payment challenge against security policies.
   */
  public evaluateChallenge(challenge: X402Challenge, providerHostOrAccount: string): {
    allowed: boolean;
    reason?: string;
  } {
    // 1. Network check
    if (!this.policy.allowedNetworks.includes(challenge.network)) {
      return {
        allowed: false,
        reason: `POLICY_VIOLATION: Network "${challenge.network}" not in allowed list [${this.policy.allowedNetworks.join(", ")}]`,
      };
    }

    // 2. Asset check
    if (!this.policy.allowedAssets.includes(challenge.asset)) {
      return {
        allowed: false,
        reason: `POLICY_VIOLATION: Asset "${challenge.asset}" is not native HBAR (0.0.0)`,
      };
    }

    // 3. Provider allowlist check
    const isRecipientAllowed = this.policy.allowedProviders.some(
      (p) => p.toLowerCase() === challenge.recipient.toLowerCase() ||
             p.toLowerCase() === providerHostOrAccount.toLowerCase()
    );
    if (!isRecipientAllowed) {
      return {
        allowed: false,
        reason: `POLICY_VIOLATION: Provider "${providerHostOrAccount}" / recipient "${challenge.recipient}" is not allowlisted`,
      };
    }

    let amountTinybars: bigint;
    try {
      amountTinybars = challenge.amountTinybars ?? parseHbarToTinybars(String(challenge.amountHbar));
    } catch {
      return { allowed: false, reason: "POLICY_VIOLATION: Invalid HBAR amount" };
    }
    if (amountTinybars <= 0n) {
      return { allowed: false, reason: "POLICY_VIOLATION: Payment amount must be positive" };
    }

    // 4. Per-transaction amount cap
    if (amountTinybars > this.policy.maxPaymentTinybars) {
      return {
        allowed: false,
        reason: `POLICY_VIOLATION: Requested amount ${formatTinybars(amountTinybars)} HBAR exceeds maximum per-transaction cap (${formatTinybars(this.policy.maxPaymentTinybars)} HBAR)`,
      };
    }

    // 5. Daily budget ceiling
    const today = new Date().toISOString().slice(0, 10);
    const currentDailySpend = this.dailySpendTracker.get(today) || 0n;
    if (currentDailySpend + amountTinybars > this.policy.maxDailyBudgetTinybars) {
      return {
        allowed: false,
        reason: `POLICY_VIOLATION: Requested payment would exceed daily budget ceiling (Current: ${formatTinybars(currentDailySpend)} HBAR, Cap: ${formatTinybars(this.policy.maxDailyBudgetTinybars)} HBAR)`,
      };
    }

    return { allowed: true };
  }

  /**
   * Records successful spend towards daily budget ceiling.
   */
  public recordSpend(amountHbar: number | string): void {
    const today = new Date().toISOString().slice(0, 10);
    const amount = parseHbarToTinybars(String(amountHbar));
    if (amount <= 0n) throw new Error("Spend must be positive");
    const currentDailySpend = this.dailySpendTracker.get(today) || 0n;
    this.dailySpendTracker.set(today, currentDailySpend + amount);
  }

  /** Compatibility display value; policy decisions remain bigint tinybars. */
  public getDailySpend(): number {
    const today = new Date().toISOString().slice(0, 10);
    return Number(formatTinybars(this.dailySpendTracker.get(today) || 0n));
  }

  public getPolicy(): Readonly<HederaPaymentPolicy> {
    return this.policy;
  }
}
