import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, authErrorResponse } from "@/lib/session";
import { HederaSettlementVerifier } from "../../../../../../../packages/hedera/src/index";
import { recordProofTrackEvent } from "@/lib/prooftrack";
import { executePaidScanAfterVerification } from "@/lib/security-scan";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = await requireSession(req);
    const pending = await prisma.agentPayment.findMany({ where: { requestedByAddress: session.address.toLowerCase(), status: "VERIFICATION_PENDING", txId: { not: null }, payerAccount: { not: null } }, take: 100 });
    const verifier = new HederaSettlementVerifier({ mirrorUrl: process.env.HEDERA_MIRROR_NODE_URL?.trim() });
    const updates = [];
    for (const payment of pending) {
      if (!payment.txId || !payment.payerAccount) continue;
      const check = await verifier.check({ txId: payment.txId, payer: payment.payerAccount, payTo: payment.providerAccount, amountTinybars: BigInt(payment.amountTinybars) });
      if (check.status === "NOT_FOUND_YET" || check.status === "UNREACHABLE") {
        updates.push({ id: payment.id, status: payment.status, verification: check.status });
        continue;
      }
      const status = check.status === "VERIFIED" ? "VERIFIED" : "FAILED_EXECUTION";
      const result = payment.serviceInputJson ? executePaidScanAfterVerification(status, JSON.parse(payment.serviceInputJson)) : null;
      await prisma.agentPayment.update({ where: { id: payment.id }, data: { status, policyDecision: check.status, ...(result ? { serviceResultJson: JSON.stringify(result) } : {}) } });
      if (payment.projectId && payment.txId) {
        await recordProofTrackEvent({ projectId: payment.projectId, ecosystem: "HEDERA", eventType: "HEDERA_AGENT_SETTLEMENT_RECONCILED", referenceType: "FACILITATOR_SETTLEMENT_ID", referenceValue: payment.txId, verificationStatus: status === "VERIFIED" ? "VERIFIED" : "FAILED" });
      }
      updates.push({ id: payment.id, status, verification: check.status });
    }
    return NextResponse.json({ success: true, updates });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    return NextResponse.json({ success: false, error: "Unable to reconcile payments" }, { status: 500 });
  }
}
