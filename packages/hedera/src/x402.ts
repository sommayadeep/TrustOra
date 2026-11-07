import { x402Client, x402HTTPClient } from "@x402/core/client";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { ExactHederaScheme as ClientHederaScheme } from "@x402/hedera/exact/client";
import { ExactHederaScheme as FacilitatorHederaScheme } from "@x402/hedera/exact/facilitator";
import {
  AccountId,
  Client,
  PrivateKey,
  createClientHederaSigner,
  createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature,
  createHederaPreflightTransfer,
} from "@x402/hedera";
import { x402Facilitator } from "@x402/core/facilitator";
import { HederaPaymentPolicy } from "./types";
import { AgentPolicyEngine } from "./policy";
import { HederaSettlementVerifier, type SettlementCheck } from "./verifier";
import { parseHederaPrivateKey, type HederaKeyType } from "./keys";
// Key parsing lives in ./keys. Re-exported here so existing importers keep working.
export {
  parseHederaPrivateKey,
  inspectHederaPrivateKey,
  normalizeHederaKeyType,
  hederaKeyTypeOf,
  derivedPublicKeyRaw,
  HederaKeyError,
  type HederaKeyType,
  type HederaKeyErrorCode,
  type HederaKeyInspection,
} from "./keys";

export const HEDERA_TESTNET = "hedera:testnet" as const;
export const HBAR_ASSET = "0.0.0" as const;

export interface X402ServiceDescriptor {
  id: string;
  name: string;
  endpoint: string;
  recipient: string;
  amountTinybars: string;
  network: typeof HEDERA_TESTNET;
  asset: typeof HBAR_ASSET;
  description: string;
  /** Facilitator account that pays consensus fees. The Hedera exact client refuses to sign without it. */
  feePayer?: string;
}

export interface X402ServiceRegistry {
  discover(): X402ServiceDescriptor[];
  get(serviceId: string): X402ServiceDescriptor | null;
}

export class StaticX402ServiceRegistry implements X402ServiceRegistry {
  private readonly services: Map<string, X402ServiceDescriptor>;

  constructor(services: X402ServiceDescriptor[]) {
    this.services = new Map(services.map((service) => [service.id, service]));
  }

  discover(): X402ServiceDescriptor[] {
    return [...this.services.values()];
  }

  get(serviceId: string): X402ServiceDescriptor | null {
    return this.services.get(serviceId) ?? null;
  }
}

export interface HederaX402Agent {
  readonly accountId: string;
  readonly http: x402HTTPClient;
  createPaymentPayload(paymentRequired: PaymentRequired): Promise<PaymentPayload>;
}

export interface PreparedHederaX402Payment {
  payload: PaymentPayload;
  paymentSignatureHeader: Record<string, string>;
  requirements: PaymentRequirements;
}

/**
 * The SDK's PrivateKey.fromString reads every non-DER key as ED25519, so the 0x-prefixed ECDSA hex
 * that the Hedera portal issues would silently become a different key and every signature would be
 * rejected. Accepts DER (either algorithm), 0x-prefixed raw hex (ECDSA) or bare raw hex (ED25519, the
 * SDK's default). Errors never include the input.
 */

export function createHederaX402Agent(
  accountId: string,
  privateKey: string,
  opts: { keyType?: HederaKeyType | undefined } = {},
): HederaX402Agent {
  const key = parseHederaPrivateKey(privateKey, { expectedType: opts.keyType });
  const signer = createClientHederaSigner(accountId, key, { network: HEDERA_TESTNET });
  const client = new x402Client().register("hedera:*", new ClientHederaScheme(signer));
  const http = new x402HTTPClient(client);
  return {
    accountId,
    http,
    createPaymentPayload: (paymentRequired) => http.createPaymentPayload(paymentRequired),
  };
}

/**
 * Validate a service's real 402 challenge and the local policy/budget before asking
 * the official Hedera signer to create a payment payload. This function never submits
 * a transaction; the protected service/facilitator flow handles settlement.
 */
export async function prepareHederaX402Payment(args: {
  agent: HederaX402Agent;
  paymentRequired: PaymentRequired;
  service: X402ServiceDescriptor;
  remainingDailyTinybars: bigint;
  policy?: Partial<HederaPaymentPolicy>;
}): Promise<PreparedHederaX402Payment> {
  const expected = paymentRequirementsForService(args.service);
  const requirements = args.paymentRequired.accepts.find((candidate) => matchesX402Requirements(candidate, expected));
  if (!requirements) throw new Error("PAYMENT_REQUIREMENT_MISMATCH");
  const amount = BigInt(requirements.amount);
  const policy = evaluateX402Policy(args.policy, requirements, new URL(args.service.endpoint).hostname);
  if (!policy.allowed) throw new Error(policy.reason ?? "PAYMENT_REJECTED_BY_POLICY");
  if (amount > args.remainingDailyTinybars) throw new Error("INSUFFICIENT_DAILY_BUDGET");
  const payload = await args.agent.createPaymentPayload({ ...args.paymentRequired, accepts: [requirements] });
  return {
    payload,
    requirements,
    paymentSignatureHeader: args.agent.http.encodePaymentSignatureHeader(payload),
  };
}

export interface HederaX402Facilitator {
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
}

export function createHederaX402Facilitator(config: {
  accountId: string;
  privateKey: string;
  mirrorNodeUrl?: string;
  keyType?: HederaKeyType | undefined;
}): HederaX402Facilitator {
  const facilitatorKey = parseHederaPrivateKey(config.privateKey, { expectedType: config.keyType });
  const scheme = new FacilitatorHederaScheme({
    getAddresses: () => [config.accountId],
    signAndSubmitTransaction: createHederaSignAndSubmitTransaction(
      (network) => {
        if (network !== HEDERA_TESTNET) throw new Error("TRUSTORA supports Hedera testnet only");
        return Client.forTestnet().setOperator(AccountId.fromString(config.accountId), facilitatorKey);
      },
      facilitatorKey,
    ),
    verifyPayerSignature: createHederaVerifyPayerSignature({ mirrorNodeUrl: config.mirrorNodeUrl }),
    preflightTransfer: createHederaPreflightTransfer({ mirrorNodeUrl: config.mirrorNodeUrl }),
  });
  return new x402Facilitator().register("hedera:*", scheme);
}

export function evaluateX402Policy(
  policy: Partial<HederaPaymentPolicy> | undefined,
  challenge: PaymentRequirements,
  providerHost: string,
) {
  const engine = new AgentPolicyEngine(policy);
  return engine.evaluateChallenge({
    scheme: challenge.scheme,
    network: challenge.network,
    asset: challenge.asset,
    recipient: challenge.payTo,
    amountHbar: challenge.amount,
    resourceId: challenge.extra.resourceId as string ?? "x402-service",
    amountTinybars: BigInt(challenge.amount),
  }, providerHost);
}

export function paymentRequirementsForService(service: X402ServiceDescriptor): PaymentRequirements {
  return {
    scheme: "exact",
    network: service.network,
    asset: service.asset,
    amount: service.amountTinybars,
    payTo: service.recipient,
    maxTimeoutSeconds: 300,
    extra: { resourceId: service.id, ...(service.feePayer ? { feePayer: service.feePayer } : {}) },
  };
}

/** Compare the payer-signed x402 terms with the merchant's exact offer. */
export function matchesX402Requirements(
  accepted: PaymentRequirements,
  expected: PaymentRequirements,
): boolean {
  return accepted.scheme === expected.scheme &&
    accepted.network === expected.network &&
    accepted.asset === expected.asset &&
    accepted.amount === expected.amount &&
    accepted.payTo === expected.payTo &&
    accepted.maxTimeoutSeconds === expected.maxTimeoutSeconds &&
    accepted.extra?.resourceId === expected.extra?.resourceId &&
    accepted.extra?.feePayer === expected.extra?.feePayer;
}

export async function settleAndVerifyX402Payment(args: {
  facilitator: HederaX402Facilitator;
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  verifier: Pick<HederaSettlementVerifier, "check">;
}): Promise<{ status: "VERIFIED" | "VERIFICATION_PENDING" | "FAILED_EXECUTION" | "REJECTED_POLICY"; txId: string | null; payer: string | null; verification: SettlementCheck | null; reason?: string }> {
  const verified = await args.facilitator.verify(args.payload, args.requirements);
  if (!verified.isValid) return { status: "REJECTED_POLICY", txId: null, payer: verified.payer ?? null, verification: null, reason: verified.invalidReason ?? "FACILITATOR_REJECTED" };
  const settlement = await args.facilitator.settle(args.payload, args.requirements);
  if (!settlement.success) return { status: "FAILED_EXECUTION", txId: null, payer: verified.payer ?? null, verification: null, reason: settlement.errorReason ?? "SETTLEMENT_FAILED" };
  const payer = verified.payer ?? null;
  const check = await args.verifier.check({
    txId: settlement.transaction,
    payer: payer ?? "",
    payTo: args.requirements.payTo,
    amountTinybars: BigInt(args.requirements.amount),
  });
  if (check.status === "VERIFIED") return { status: "VERIFIED", txId: settlement.transaction, payer, verification: check };
  if (check.status === "NOT_FOUND_YET" || check.status === "UNREACHABLE") return { status: "VERIFICATION_PENDING", txId: settlement.transaction, payer, verification: check };
  return { status: "FAILED_EXECUTION", txId: settlement.transaction, payer, verification: check, reason: check.status };
}
