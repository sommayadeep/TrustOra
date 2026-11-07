import { prisma } from "./prisma";
import {
  ProofTrackEngine,
  ProofTrackEcosystem,
  ProofTrackReferenceType,
  VerificationStatus,
  generateProjectId,
} from "../../../../packages/prooftrack/src/index";

export { generateProjectId };

export async function recordProofTrackEvent(params: {
  projectId: string;
  sequence?: number;
  ecosystem: ProofTrackEcosystem;
  eventType: string;
  referenceType: ProofTrackReferenceType;
  referenceValue: string;
  verificationStatus?: VerificationStatus;
}) {
  // Idempotent: the same reference (e.g. a tx hash) is recorded once per project.
  const existing = await prisma.proofTrackEventRecord.findFirst({
    where: {
      projectId: params.projectId,
      referenceType: params.referenceType,
      referenceValue: params.referenceValue,
    },
  });
  if (existing) {
    if (params.verificationStatus && existing.verificationStatus !== params.verificationStatus) {
      return prisma.proofTrackEventRecord.update({ where: { id: existing.id }, data: { verificationStatus: params.verificationStatus, ...(params.eventType ? { eventType: params.eventType } : {}) } });
    }
    return existing;
  }

  const explorerUrl = ProofTrackEngine.getExplorerUrl(
    params.ecosystem,
    params.referenceType,
    params.referenceValue
  );

  // (projectId, sequence) is unique in the schema; on a concurrent insert, recompute and retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await prisma.proofTrackEventRecord.count({
      where: { projectId: params.projectId },
    });
    try {
      return await prisma.proofTrackEventRecord.create({
        data: {
          projectId: params.projectId,
          sequence: params.sequence ?? count + 1,
          ecosystem: params.ecosystem,
          eventType: params.eventType,
          referenceType: params.referenceType,
          referenceValue: params.referenceValue,
          explorerUrl,
          // Events are pending unless the caller has completed a real verification step.
          verificationStatus: params.verificationStatus ?? "PENDING",
        },
      });
    } catch (err: any) {
      if (err?.code !== "P2002") throw err;
      const duplicate = await prisma.proofTrackEventRecord.findFirst({
        where: {
          projectId: params.projectId,
          referenceType: params.referenceType,
          referenceValue: params.referenceValue,
        },
      });
      if (duplicate) return duplicate;
      if (params.sequence !== undefined) throw err; // explicit sequence collided: do not renumber
    }
  }
  throw new Error("Could not allocate a ProofTrack sequence number");
}

export async function getProjectProofTimeline(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      milestones: true,
      proofTrackEvents: {
        orderBy: { sequence: "asc" },
      },
      agreementVersions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
      },
    },
  });

  if (!project) return null;

  const releasedCount = project.milestones.filter(
    (m) => m.state === "RELEASED"
  ).length;
  const totalCount = project.milestones.length;

  return {
    project,
    events: project.proofTrackEvents,
    completionRatio: totalCount > 0 ? releasedCount / totalCount : 0,
    isFullySettled: totalCount > 0 && releasedCount >= totalCount,
  };
}

