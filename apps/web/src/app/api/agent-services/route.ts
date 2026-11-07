import { NextResponse } from "next/server";
import { requireSession, authErrorResponse } from "@/lib/session";
import { configuredHederaServices } from "@/lib/hedera";
import { isHederaAccountId } from "../../../../../../packages/hedera/src/index";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const services = configuredHederaServices().discover();
    return NextResponse.json({
      success: true,
      services,
      agentPolicy: {
        autonomousEnabled: process.env.HEDERA_AGENT_AUTOPAY_ENABLED === "true" &&
          !!process.env.HEDERA_AGENT_PRIVATE_KEY?.trim() && !!process.env.HEDERA_FACILITATOR_PRIVATE_KEY?.trim() &&
          isHederaAccountId(process.env.HEDERA_AGENT_ACCOUNT_ID?.trim() ?? "") &&
          isHederaAccountId(process.env.HEDERA_FACILITATOR_ACCOUNT_ID?.trim() ?? "") &&
          services.length > 0 && services.every((service) => isHederaAccountId(service.recipient)),
        requireApproval: process.env.HEDERA_AGENT_REQUIRE_APPROVAL !== "false",
        maxPaymentTinybars: "100000000",
        maxDailyBudgetTinybars: "500000000",
        rollingWindowHours: 24,
      },
    });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    return NextResponse.json({ success: false, error: "Unable to discover services" }, { status: 500 });
  }
}
