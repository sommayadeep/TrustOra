import { prisma } from "./prisma";
import { DEFAULT_HEDERA_POLICY } from "../../../../packages/hedera/src/policy";

/**
 * Persistent reservation ledger for Hedera spending limits.
 * Reservations are single-use and counted for 24 hours before a facilitator
 * flow is allowed to submit a payment. Replays never re-enter settlement.
 */
export async function reserveHederaSpend(amountTinybars: bigint, idempotencyKey: string, requestedByAddress: string, budgetScope: "REQUESTER" | "GLOBAL" = "REQUESTER"): Promise<{ allowed: boolean; reason?: string }> {
  if (amountTinybars <= 0n || !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey) || !/^0x[0-9a-f]{40}$/i.test(requestedByAddress)) {
    return { allowed: false, reason: "INVALID_SPEND_RESERVATION" };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.agentPayment.findUnique({ where: { idempotencyKey } });
      if (existing) return { allowed: false, reason: "DUPLICATE_PAYMENT" };

      const recent = await tx.agentPayment.findMany({
        where: {
          ...(budgetScope === "GLOBAL" ? {} : { requestedByAddress: requestedByAddress.toLowerCase() }),
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          status: { in: ["PENDING", "SETTLED", "VERIFIED", "VERIFICATION_PENDING", "FAILED_EXECUTION"] },
        },
        select: { amountTinybars: true },
      });
      const spent = recent.reduce((sum, payment) => sum + BigInt(payment.amountTinybars), 0n);
      if (spent + amountTinybars > DEFAULT_HEDERA_POLICY.maxDailyBudgetTinybars) {
        return { allowed: false, reason: "DAILY_BUDGET_EXCEEDED" };
      }

      await tx.agentPayment.create({
        data: {
          idempotencyKey,
          requestedByAddress: requestedByAddress.toLowerCase(),
          serviceName: "x402 facilitator reservation",
          providerAccount: "pending",
          amountTinybars: amountTinybars.toString(),
          status: "PENDING",
          policyDecision: "PERSISTENT_BUDGET_RESERVED",
        },
      });
      return { allowed: true };
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return { allowed: false, reason: "DUPLICATE_PAYMENT" };
    }
    throw error;
  }
}
