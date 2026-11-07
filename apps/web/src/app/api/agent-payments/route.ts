import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, authErrorResponse } from "@/lib/session";
import { isHederaAccountId } from "../../../../../../packages/hedera/src/index";
import { configuredHederaServices } from "@/lib/hedera";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    const payments = await prisma.agentPayment.findMany({
      where: { requestedByAddress: session.address.toLowerCase() },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const services = configuredHederaServices().discover();
    const autonomousEnabled = process.env.HEDERA_AGENT_AUTOPAY_ENABLED === "true" &&
      !!process.env.HEDERA_AGENT_PRIVATE_KEY?.trim() && !!process.env.HEDERA_FACILITATOR_PRIVATE_KEY?.trim() &&
      isHederaAccountId(process.env.HEDERA_AGENT_ACCOUNT_ID?.trim() ?? "") &&
      isHederaAccountId(process.env.HEDERA_FACILITATOR_ACCOUNT_ID?.trim() ?? "") &&
      services.length > 0 && services.every((service) => isHederaAccountId(service.recipient));
    const recent = await prisma.agentPayment.findMany({
      where: { ...(autonomousEnabled ? {} : { requestedByAddress: session.address.toLowerCase() }), createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, status: { in: ["PENDING", "SETTLED", "VERIFIED", "VERIFICATION_PENDING", "FAILED_EXECUTION"] } },
      select: { amountTinybars: true },
    });
    const spentTinybars = recent.reduce((sum, payment) => sum + BigInt(payment.amountTinybars), 0n).toString();
    const dailyBudget = 500_000_000n;
    return NextResponse.json({ success: true, payments, policy: { maxPaymentTinybars: "100000000", maxDailyBudgetTinybars: dailyBudget.toString(), spentTinybars, remainingDailyTinybars: (dailyBudget > BigInt(spentTinybars) ? dailyBudget - BigInt(spentTinybars) : 0n).toString(), rollingWindowHours: 24, scope: autonomousEnabled ? "shared dedicated agent wallet" : "authenticated account" } });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    return NextResponse.json({ success: false, error: "Unable to load payment history" }, { status: 500 });
  }
}
