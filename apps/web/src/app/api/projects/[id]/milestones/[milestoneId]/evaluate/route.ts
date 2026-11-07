import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { run0GEvaluation } from "@/lib/0g";
import { recordProofTrackEvent } from "@/lib/prooftrack";
import { authErrorResponse, requireAccountRole, requireSession } from "@/lib/session";
import { canPerform } from "@/lib/authz";
import { loadMilestoneInProject, readJsonBody } from "@/lib/escrow-db";

export const dynamic = "force-dynamic";

/**
 * Advisory AI evaluation of the latest submission, requested by the project client.
 *
 * INVARIANT: this route only reads the deliverable and stores a report. It never touches escrow
 * state, never signs, and never sends a transaction. Only the client's own wallet can release funds.
 *
 * Body: { aiConsent: true }. No deliverable text leaves the server without that explicit consent.
 * Hedera x402 agent payments are intentionally not triggered here: that integration does not yet
 * submit real transfers, and this route will not present a simulated one as settled.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; milestoneId: string }> }
) {
  try {
    const { id, milestoneId } = await params;
    const session = await requireSession(req);
    await requireAccountRole(session.address, "CLIENT");
    const body = await readJsonBody(req);

    const milestone = await loadMilestoneInProject(id, milestoneId);
    if (!milestone) {
      return NextResponse.json({ success: false, error: "Milestone not found in this project" }, { status: 404 });
    }
    if (!canPerform(session.address, milestone.project, ["client"])) {
      return NextResponse.json({ success: false, error: "Only the project client can request an evaluation" }, { status: 403 });
    }
    if (body.aiConsent !== true) {
      return NextResponse.json(
        { success: false, code: "CONSENT_REQUIRED", error: "Explicit consent is required before the deliverable is sent to an AI provider" },
        { status: 400 }
      );
    }
    if (milestone.state !== "SUBMITTED") {
      return NextResponse.json(
        { success: false, error: `Milestone is ${milestone.state}; evaluation applies to work that is SUBMITTED on-chain` },
        { status: 409 }
      );
    }

    // Only work whose hash is anchored on Arc is evaluated, so the AI judges exactly what the escrow records.
    const submission = await prisma.submission.findFirst({
      where: { milestoneId, anchorTxHash: { not: null } },
      orderBy: { version: "desc" },
    });
    if (!submission) {
      return NextResponse.json({ success: false, error: "No on-chain anchored submission found to evaluate" }, { status: 409 });
    }
    const previous = await prisma.evaluationReport.findFirst({
      where: { submissionId: submission.id, inferenceRequestId: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (previous) {
      return NextResponse.json({ success: true, advisoryOnly: true, report: previous, modelCalled: true, reused: true });
    }
    const content = submission.content ?? "";
    if (!content || crypto.createHash("sha256").update(content).digest("hex") !== submission.deliverableHash) {
      return NextResponse.json(
        { success: false, error: "The stored deliverable text does not match its anchored hash, so it will not be evaluated" },
        { status: 409 }
      );
    }

    const agreement = await prisma.agreementVersion.findFirst({
      where: { projectId: id },
      orderBy: { versionNumber: "desc" },
    });
    if (!agreement) {
      return NextResponse.json({ success: false, error: "No agreement version found" }, { status: 409 });
    }
    const criteria = (JSON.parse(agreement.criteriaJson || "[]") as Array<{ id: string; text: string }>).map((c) => ({
      id: c.id,
      text: c.text,
    }));

    const report = await run0GEvaluation({
      criteriaVersion: `v${agreement.versionNumber}`,
      criteria,
      submissionContent: content,
      submissionHash: submission.deliverableHash,
      aiConsentGiven: true,
    });

    const record = await prisma.evaluationReport.create({
      data: {
        submissionId: submission.id,
        overallVerdict: report.overall,
        inferenceRequestId: report.requestId,
        requestIdSource: report.requestIdSource,
        providerAddress: report.providerAddress,
        teeVerified: report.teeVerified,
        teeVerifiedBy: report.teeVerifiedBy,
        modelId: report.modelId,
        criteriaResultsJson: JSON.stringify(report.criteria),
        findingsJson: JSON.stringify(report.limitations),
        reportHash: report.reportHash,
        promptHash: report.promptHash ?? "NO_MODEL_CALLED",
        advisoryNotice: report.advisoryNotice,
      },
    });

    // An inference request ID is vendor-reported and is NOT a blockchain transaction: it stays PENDING
    // (not independently verified) and has no explorer link.
    if (report.requestId) {
      await recordProofTrackEvent({
        projectId: id,
        ecosystem: "ZERO_G",
        eventType: "0G_EVALUATION_COMPLETED",
        referenceType: "INFERENCE_REQUEST_ID",
        referenceValue: report.requestId,
        verificationStatus: "PENDING",
      });
    }

    return NextResponse.json({ success: true, advisoryOnly: true, report: record, modelCalled: report.modelCalled });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("Evaluation error:", error);
    return NextResponse.json({ success: false, error: "Failed to evaluate deliverable" }, { status: 500 });
  }
}
