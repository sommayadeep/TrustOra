import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from "@x402/core/http";
import { prisma } from "@/lib/prisma";
import { requireSession, authErrorResponse } from "@/lib/session";
import { configuredHederaServices } from "@/lib/hedera";
import { paymentRequirementsForService, matchesX402Requirements, evaluateX402Policy, createHederaX402Facilitator, settleAndVerifyX402Payment } from "../../../../../../../packages/hedera/src/index";
import { HederaSettlementVerifier, isHederaAccountId, toMirrorTransactionId } from "../../../../../../../packages/hedera/src/index";
import { reserveHederaSpend } from "@/lib/hedera-ledger";
import { recordProofTrackEvent } from "@/lib/prooftrack";
import { executePaidScanAfterVerification, validateScanInput } from "@/lib/security-scan";
import { createHederaX402Agent, prepareHederaX402Payment, normalizeHederaKeyType } from "../../../../../../../packages/hedera/src/index";

export const dynamic = "force-dynamic";

function facilitatorFromEnv() {
  const accountId = process.env.HEDERA_FACILITATOR_ACCOUNT_ID?.trim();
  const privateKey = process.env.HEDERA_FACILITATOR_PRIVATE_KEY?.trim();
  if (!accountId || !privateKey) return null;
  return createHederaX402Facilitator({
    accountId,
    privateKey,
    mirrorNodeUrl: process.env.HEDERA_MIRROR_NODE_URL?.trim(),
    keyType: normalizeHederaKeyType(process.env.HEDERA_FACILITATOR_KEY_TYPE),
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  try {
    await requireSession(req);
    const service = configuredHederaServices().get((await params).serviceId);
    if (!service) return NextResponse.json({ success: false, error: "Service unavailable" }, { status: 404 });
    return NextResponse.json({ success: true, service });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    return NextResponse.json({ success: false, error: "Unable to load service" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  try {
    const session = await requireSession(req);
    const service = configuredHederaServices().get((await params).serviceId);
    if (!service) return NextResponse.json({ success: false, error: "Service unavailable" }, { status: 404 });
    const requirements = paymentRequirementsForService(service);
    const body = await req.json().catch(() => ({})) as { consent?: boolean; projectId?: string; files?: Record<string, string> };
    if (body.projectId) {
      const project = await prisma.project.findUnique({
        where: { id: body.projectId },
        select: { clientAddress: true, freelancerAddress: true, arbiterAddress: true },
      });
      if (!project) return NextResponse.json({ success: false, error: "Project unavailable" }, { status: 404 });
      const wallet = session.address.toLowerCase();
      if (![project.clientAddress, project.freelancerAddress, project.arbiterAddress].some((address) => address?.toLowerCase() === wallet)) {
        return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
      }
    }
    const paymentHeader = req.headers.get("PAYMENT-SIGNATURE") ?? req.headers.get("X-PAYMENT");
    if (!paymentHeader) {
      if ((body as { autonomous?: boolean }).autonomous === true) {
        const activity: Array<{ step: string; status: "OK" | "REJECTED" | "PENDING"; detail: string }> = [];
        const agentAccountId = process.env.HEDERA_AGENT_ACCOUNT_ID?.trim();
        const agentPrivateKey = process.env.HEDERA_AGENT_PRIVATE_KEY?.trim();
        const facilitatorAccountId = process.env.HEDERA_FACILITATOR_ACCOUNT_ID?.trim();
        const facilitatorPrivateKey = process.env.HEDERA_FACILITATOR_PRIVATE_KEY?.trim();
        const complete = !!agentAccountId && !!agentPrivateKey && !!facilitatorAccountId && !!facilitatorPrivateKey && isHederaAccountId(agentAccountId) && isHederaAccountId(facilitatorAccountId) && isHederaAccountId(service.recipient);
        if (process.env.HEDERA_AGENT_AUTOPAY_ENABLED !== "true" || !complete) {
          return NextResponse.json({ success: false, status: "NOT_CONFIGURED", error: "Dedicated agent wallet, in-process facilitator, or service recipient configuration is incomplete", agentActivity: [{ step: "policy", status: "REJECTED", detail: "No payment or signing attempted; autonomous mode is disabled or required testnet account/key settings are incomplete." }] }, { status: 503 });
        }
        const requireApproval = process.env.HEDERA_AGENT_REQUIRE_APPROVAL !== "false";
        if (requireApproval && body.consent !== true) {
          return NextResponse.json({ success: false, status: "REJECTED_POLICY", error: "This agent policy requires explicit approval for each payment", agentActivity: [{ step: "policy", status: "REJECTED", detail: "Per-payment approval is required by policy." }] }, { status: 400 });
        }
        const origin = new URL(req.url).origin;
        const endpoint = new URL(service.endpoint);
        if (endpoint.origin !== origin) {
          return NextResponse.json({ success: false, status: "REJECTED_POLICY", error: "Autonomous mode only calls the same-origin configured service", agentActivity: [{ step: "discovery", status: "REJECTED", detail: "Service origin does not match this app." }] }, { status: 400 });
        }
        activity.push({ step: "discovery", status: "OK", detail: `Selected ${service.name}.` });
        let files: Record<string, string>;
        try { validateScanInput(body.files); files = body.files!; }
        catch (error) { return NextResponse.json({ success: false, status: "REJECTED_POLICY", error: error instanceof Error ? error.message : "Invalid scan input", agentActivity: activity }); }
        let firstResponse: Response;
        try {
          firstResponse = await fetch(req.url, {
            method: "POST",
            headers: { "content-type": "application/json", cookie: req.headers.get("cookie") ?? "" },
            body: JSON.stringify({ projectId: body.projectId, files }),
            cache: "no-store",
          });
        } catch {
          return NextResponse.json({ success: false, status: "FAILED_EXECUTION", error: "Unable to reach discovered service", agentActivity: [...activity, { step: "service request", status: "REJECTED" as const, detail: "Initial request failed." }] }, { status: 502 });
        }
        if (firstResponse.status !== 402) {
          return NextResponse.json({ success: false, status: "FAILED_EXECUTION", error: `Expected HTTP 402, received ${firstResponse.status}`, agentActivity: [...activity, { step: "x402 challenge", status: "REJECTED", detail: "Service did not return a payment requirement." }] }, { status: 502 });
        }
        activity.push({ step: "x402 challenge", status: "OK", detail: "Received HTTP 402 payment requirements." });
        let remainingDaily: bigint;
        try {
          const recent = await prisma.agentPayment.findMany({
            where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, status: { in: ["PENDING", "SETTLED", "VERIFIED", "VERIFICATION_PENDING", "FAILED_EXECUTION"] } },
            select: { amountTinybars: true },
          });
          const spent = recent.reduce((sum, payment) => sum + BigInt(payment.amountTinybars), 0n);
          remainingDaily = 500_000_000n - spent;
        } catch {
          return NextResponse.json({ success: false, status: "FAILED_EXECUTION", error: "Could not check the rolling spend budget", agentActivity: activity }, { status: 503 });
        }
        if (remainingDaily <= 0n) {
          activity.push({ step: "spending policy", status: "REJECTED", detail: "Rolling 24-hour budget is exhausted." });
          return NextResponse.json({ success: false, status: "REJECTED_POLICY", error: "DAILY_BUDGET_EXCEEDED", agentActivity: activity }, { status: 403 });
        }
        let agent;
        try {
          agent = createHederaX402Agent(agentAccountId, agentPrivateKey, {
            keyType: normalizeHederaKeyType(process.env.HEDERA_AGENT_KEY_TYPE),
          });
        }
        catch {
          return NextResponse.json({ success: false, status: "NOT_CONFIGURED", error: "Dedicated agent wallet configuration is invalid", agentActivity: activity }, { status: 503 });
        }
        try {
          const challenge = agent.http.getPaymentRequiredResponse(
            (name) => firstResponse.headers.get(name),
            await firstResponse.json(),
          );
          const configuredProviders = process.env.HEDERA_ALLOWED_PROVIDERS?.split(",").map((value) => value.trim()).filter(Boolean);
          const prepared = await prepareHederaX402Payment({
            agent,
            paymentRequired: challenge,
            service,
            remainingDailyTinybars: remainingDaily,
            policy: configuredProviders?.length ? { allowedProviders: configuredProviders } : undefined,
          });
          activity.push({ step: "spending policy", status: "OK", detail: "Network, asset, recipient, amount, allowlist and available daily budget approved." });
          activity.push({ step: "agent signature", status: "OK", detail: "Official Hedera x402 client signed the exact approved requirements with the dedicated testnet agent wallet." });
          const headers = agent.http.encodePaymentSignatureHeader(prepared.payload);
          const paidResponse = await fetch(req.url, {
            method: "POST",
            headers: { "content-type": "application/json", cookie: req.headers.get("cookie") ?? "", "x-trustora-autonomous-agent": "true", ...headers },
            body: JSON.stringify({ consent: true, projectId: body.projectId, files }),
            cache: "no-store",
          });
          const paidBody = await paidResponse.json().catch(() => ({}));
          const finalActivity = [...activity, { step: "paid request", status: paidResponse.ok ? "OK" as const : "PENDING" as const, detail: paidBody.status === "VERIFIED" ? "Mirror Node verified the payment before the scan result was returned." : `Service returned ${paidBody.status ?? paidResponse.status}; scan is withheld until Mirror Node verification.` }];
          return NextResponse.json({ ...paidBody, agentActivity: finalActivity }, { status: paidResponse.status });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Agent payment rejected";
          activity.push({ step: "spending policy", status: "REJECTED", detail: message });
          return NextResponse.json({ success: false, status: "REJECTED_POLICY", error: message, agentActivity: activity }, { status: 403 });
        }
      }
      return new NextResponse(JSON.stringify({ success: false, error: "Payment required", status: "PENDING" }), {
        status: 402,
        headers: { "content-type": "application/json", "PAYMENT-REQUIRED": encodePaymentRequiredHeader({
          x402Version: 2,
          resource: { url: service.endpoint, description: service.description, mimeType: "application/json", serviceName: service.name },
          accepts: [requirements],
        }) },
      });
    }

    if (body.consent !== true) {
      return NextResponse.json({ success: false, status: "REJECTED_POLICY", error: "Explicit payment consent is required" }, { status: 400 });
    }
    const facilitator = facilitatorFromEnv();
    if (!facilitator) return NextResponse.json({ success: false, status: "NOT_CONFIGURED", error: "Hedera facilitator is not configured" }, { status: 503 });
    const payload = decodePaymentSignatureHeader(paymentHeader);
    if (!matchesX402Requirements(payload.accepted, requirements)) {
      return NextResponse.json({ success: false, status: "REJECTED_POLICY", error: "Payment requirements do not match this service" }, { status: 402 });
    }
    const allowedProviders = process.env.HEDERA_ALLOWED_PROVIDERS?.split(",").map((value) => value.trim()).filter(Boolean);
    const policy = evaluateX402Policy(
      allowedProviders?.length ? { allowedProviders } : undefined,
      requirements,
      new URL(service.endpoint).hostname,
    );
    if (!policy.allowed) return NextResponse.json({ success: false, status: "REJECTED_POLICY", error: policy.reason }, { status: 403 });

    const idempotencyKey = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const existing = await prisma.agentPayment.findUnique({ where: { idempotencyKey } });
    if (existing && existing.requestedByAddress !== session.address.toLowerCase()) {
      return NextResponse.json({ success: false, status: "REJECTED_POLICY", error: "This signed payment payload is already bound to another agent" }, { status: 409 });
    }
    if (existing) {
      if (existing.status === "VERIFIED" && !existing.serviceResultJson && existing.serviceInputJson) {
        const result = executePaidScanAfterVerification(existing.status, JSON.parse(existing.serviceInputJson))!;
        const completed = await prisma.agentPayment.update({ where: { id: existing.id }, data: { serviceResultJson: JSON.stringify(result) } });
        return NextResponse.json({ success: true, status: completed.status, payment: completed, result });
      }
      return NextResponse.json({ success: true, status: existing.status, payment: existing, result: existing.serviceResultJson ? JSON.parse(existing.serviceResultJson) : undefined });
    }
    try { validateScanInput(body.files); } catch (error) {
      return NextResponse.json({ success: false, status: "REJECTED_POLICY", error: error instanceof Error ? error.message : "Invalid scan input" }, { status: 400 });
    }
    const reservation = await reserveHederaSpend(BigInt(service.amountTinybars), idempotencyKey, session.address, req.headers.get("x-trustora-autonomous-agent") === "true" ? "GLOBAL" : "REQUESTER");
    if (!reservation.allowed) {
      const duplicate = reservation.reason === "DUPLICATE_PAYMENT";
      return NextResponse.json({ success: false, status: "REJECTED_POLICY", error: reservation.reason }, { status: duplicate ? 409 : 403 });
    }
    const pending = await prisma.agentPayment.update({
      where: { idempotencyKey },
      data: { serviceName: service.name, providerAccount: service.recipient, projectId: body.projectId ?? null, serviceInputJson: JSON.stringify(body.files), policyDecision: "ALLOWLIST_AND_BUDGET_APPROVED" },
    });
    let flow;
    try {
      flow = await settleAndVerifyX402Payment({ facilitator, payload, requirements, verifier: new HederaSettlementVerifier({ mirrorUrl: process.env.HEDERA_MIRROR_NODE_URL?.trim() }) });
    } catch {
      const failed = await prisma.agentPayment.update({ where: { id: pending.id }, data: { status: "FAILED_EXECUTION", policyDecision: "FACILITATOR_OR_VERIFIER_ERROR" } });
      return NextResponse.json({ success: false, status: failed.status, payment: failed, error: "Payment verification or settlement failed" }, { status: 502 });
    }
    if (flow.status === "REJECTED_POLICY") {
      const rejected = await prisma.agentPayment.update({ where: { id: pending.id }, data: { status: flow.status, policyDecision: flow.reason ?? "FACILITATOR_REJECTED" } });
      return NextResponse.json({ success: false, status: rejected.status, payment: rejected }, { status: 402 });
    }
    if (flow.status === "FAILED_EXECUTION" && !flow.txId) {
      const failed = await prisma.agentPayment.update({ where: { id: pending.id }, data: { status: flow.status, policyDecision: flow.reason ?? "SETTLEMENT_FAILED" } });
      return NextResponse.json({ success: false, status: failed.status, payment: failed }, { status: 502 });
    }
    const txId = flow.txId!;
    const transactionIsValid = toMirrorTransactionId(txId) !== null;
    const check = flow.verification!;
    const status = flow.status;
    const payment = await prisma.agentPayment.update({
      where: { id: pending.id },
      data: {
        status,
        payerAccount: flow.payer,
        txId: transactionIsValid ? txId : null,
        hashscanUrl: transactionIsValid ? new HederaSettlementVerifier().getHashScanUrl(txId) : null,
        settledAt: transactionIsValid ? new Date() : null,
        policyDecision: check.status,
      },
    });
    if (transactionIsValid && body.projectId) {
      await recordProofTrackEvent({
        projectId: body.projectId,
        ecosystem: "HEDERA",
        eventType: check.status === "VERIFIED" ? "HEDERA_AGENT_SETTLED" : "HEDERA_FACILITATOR_TRANSACTION",
        referenceType: "FACILITATOR_SETTLEMENT_ID",
        referenceValue: txId,
        verificationStatus: check.status === "VERIFIED"
          ? "VERIFIED"
          : check.status === "NOT_FOUND_YET" || check.status === "UNREACHABLE"
            ? "PENDING"
            : "FAILED",
      });
    }
    // Paid work runs only after the exact payment is confirmed by Mirror Node.
    if (status !== "VERIFIED") return NextResponse.json({ success: true, status, payment, verification: check });
    let result;
    try {
      result = executePaidScanAfterVerification(status, body.files)!;
    } catch (error) {
      const failed = await prisma.agentPayment.update({ where: { id: payment.id }, data: { status: "FAILED_EXECUTION", policyDecision: "PAYMENT_VERIFIED_SCAN_INPUT_INVALID" } });
      return NextResponse.json({ success: false, status: failed.status, payment: failed, error: error instanceof Error ? error.message : "Invalid scan input" }, { status: 400 });
    }
    const completed = await prisma.agentPayment.update({ where: { id: payment.id }, data: { serviceResultJson: JSON.stringify(result) } });
    return NextResponse.json({ success: true, status: "VERIFIED", payment: completed, verification: check, result });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    return NextResponse.json({ success: false, status: "FAILED_EXECUTION", error: "Payment processing failed" }, { status: 500 });
  }
}
