import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildPublicProjectEvidence, isHederaTx, validPublicTransactionReference } from "@/lib/public-prooftrack";
import { toMirrorTransactionId } from "../../../../../../../packages/hedera/src/index";

export const dynamic = "force-dynamic";

const projectIdPattern = /^TRU-PROJ-\d{4}-\d{7}$/;

async function loadPublicProject(id: string) {
  const project = await prisma.project.findFirst({
    where: { id, publishedAt: { not: null } },
    select: {
      id: true, status: true, registerTxHash: true, createdAt: true,
      milestones: {
        orderBy: { milestoneIndex: "asc" },
        select: {
          milestoneIndex: true, state: true, addTxHash: true, fundingTxHash: true, releaseTxHash: true, fundedAt: true, releasedAt: true,
          submissions: {
            orderBy: { version: "asc" },
            select: {
              version: true, anchorTxHash: true, submittedAt: true,
              evaluations: {
                orderBy: { createdAt: "asc" },
                select: { overallVerdict: true, inferenceRequestId: true, requestIdSource: true, teeVerified: true, teeVerifiedBy: true, modelId: true, reportHash: true, createdAt: true },
              },
            },
          },
        },
      },
      proofTrackEvents: { orderBy: { sequence: "asc" }, select: { ecosystem: true, eventType: true, referenceType: true, referenceValue: true, verificationStatus: true, timestamp: true } },
    },
  });
  if (!project) return null;
  const payments = await prisma.agentPayment.findMany({
    where: { projectId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, serviceName: true, providerAccount: true, amountTinybars: true, txId: true, status: true, createdAt: true, serviceResultJson: true },
  });
  return buildPublicProjectEvidence(project, payments);
}

async function matchingPublicProjectIds(reference: string): Promise<string[]> {
  const ids = new Set<string>();
  if (/^0x[a-f\d]{64}$/i.test(reference)) {
    const matches = await prisma.project.findMany({
      where: {
        publishedAt: { not: null },
        OR: [
          { registerTxHash: reference },
          { milestones: { some: { OR: [{ addTxHash: reference }, { fundingTxHash: reference }, { releaseTxHash: reference }] } } },
          { milestones: { some: { submissions: { some: { anchorTxHash: reference } } } } },
        ],
      }, select: { id: true },
    });
    matches.forEach((project) => ids.add(project.id));
  }
  if (isHederaTx(reference)) {
    const mirrorId = toMirrorTransactionId(reference)!;
    const match = /^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/.exec(mirrorId)!;
    const equivalents = [...new Set([reference, mirrorId, `${match[1]}@${match[2]}.${match[3]}`])];
    const [events, payments] = await Promise.all([
      prisma.proofTrackEventRecord.findMany({ where: { referenceValue: { in: equivalents }, ecosystem: "HEDERA", project: { is: { publishedAt: { not: null } } } }, select: { projectId: true } }),
      prisma.agentPayment.findMany({ where: { txId: { in: equivalents }, projectId: { not: null } }, select: { projectId: true } }),
    ]);
    events.forEach((event) => ids.add(event.projectId));
    payments.forEach((payment) => { if (payment.projectId) ids.add(payment.projectId); });
    const publicProjects = await prisma.project.findMany({ where: { id: { in: [...ids] }, publishedAt: { not: null } }, select: { id: true } });
    const allowed = new Set(publicProjects.map((project) => project.id));
    for (const id of ids) if (!allowed.has(id)) ids.delete(id);
  }
  return [...ids];
}

/** Public read-only ProofTrack API. It returns a strict evidence allowlist for published projects. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project");
  const reference = url.searchParams.get("transaction");
  if ((projectId && reference) || (!projectId && !reference)) {
    return NextResponse.json({ success: false, error: "Provide exactly one project or transaction reference" }, { status: 400 });
  }
  if (projectId) {
    if (!projectIdPattern.test(projectId)) return NextResponse.json({ success: false, error: "Invalid project reference" }, { status: 400 });
    const project = await loadPublicProject(projectId);
    return project
      ? NextResponse.json({ success: true, projects: [project] })
      : NextResponse.json({ success: false, error: "No public verification record found" }, { status: 404 });
  }
  if (!reference || reference.length > 180 || !validPublicTransactionReference(reference)) {
    return NextResponse.json({ success: false, error: "Invalid transaction reference" }, { status: 400 });
  }
  const ids = await matchingPublicProjectIds(reference);
  if (ids.length === 0) return NextResponse.json({ success: false, error: "No public verification record found" }, { status: 404 });
  const projects = (await Promise.all(ids.map(loadPublicProject))).filter((project): project is NonNullable<typeof project> => project !== null);
  return NextResponse.json({ success: true, reference, projects });
}
