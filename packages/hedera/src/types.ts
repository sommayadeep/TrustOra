/**
 * @file types.ts
 * @description Types for Hedera x402 autonomous agent payments and policy enforcement.
 */

export interface HederaPaymentPolicy {
  maxPaymentTinybars: bigint;   // Maximum allowed per single request
  maxDailyBudgetTinybars: bigint; // Maximum total spend allowed per 24 hours
  allowedProviders: string[];   // Hostnames or Hedera account IDs allowed to receive payment
  allowedNetworks: string[];    // Permitted networks (e.g. ['hedera:testnet'])
  allowedAssets: string[];      // Permitted assets (e.g. ['0.0.0'] for native HBAR)
}

export interface X402Challenge {
  scheme: "exact" | string;
  network: string;              // e.g. "hedera:testnet"
  asset: string;                // e.g. "0.0.0"
  recipient: string;            // Hedera Account ID, e.g. "0.0.482910"
  /** Decimal HBAR amount retained for display/backward compatibility. */
  amountHbar: number | string;
  /** Exact x402 amount in tinybars, when supplied by a v2 challenge. */
  amountTinybars?: bigint;
  resourceId: string;           // Target service or deliverable ID
  facilitatorUrl?: string;
}

export type PaymentExecutionStatus =
  | "PENDING"
  | "MOCKED"
  | "SETTLED"
  | "VERIFIED"
  | "REJECTED_POLICY"
  | "FAILED_EXECUTION"
  | "VERIFICATION_PENDING"
  | "NOT_CONFIGURED";

export interface AuditLogEntry {
  step: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface AgentPaymentResult {
  status: PaymentExecutionStatus;
  txId: string | null;
  amountHbar: number | string;
  amountTinybars?: string;
  recipient: string;
  timestamp: string;
  hashscanUrl: string | null;
  rejectionReason?: string;
  auditLog: AuditLogEntry[];
}

export interface SettlementVerification {
  isVerified: boolean;
  consensusTimestamp?: string;
  transfers?: Array<{ account: string; amount: number }>;
  statusString?: string;
  error?: string;
}
