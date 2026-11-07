import { ProofTrackEngine, type ProofTrackReferenceType } from "../../../../packages/prooftrack/src/index";
import { toMirrorTransactionId } from "../../../../packages/hedera/src/index";

export type PublicVerificationStatus = "PENDING" | "VERIFIED" | "FAILED" | "UNVERIFIED";

type PublicProjectRecord = {
  id: string;
  status: string;
  registerTxHash: string | null;
  createdAt: Date | string;
  milestones: Array<{
    milestoneIndex: number;
    state: string;
    addTxHash: string | null;
    fundingTxHash: string | null;
    releaseTxHash: string | null;
    fundedAt: Date | string | null;
    releasedAt: Date | string | null;
    submissions: Array<{
      version: number;
      anchorTxHash: string | null;
      submittedAt: Date | string;
      evaluations: Array<{
        overallVerdict: string;
        inferenceRequestId: string | null;
        requestIdSource: string | null;
        teeVerified: boolean | null;
        teeVerifiedBy: string | null;
        modelId: string | null;
        reportHash: string;
        createdAt: Date | string;
      }>;
    }>;
  }>;
  proofTrackEvents: Array<{
    ecosystem: string;
    eventType: string;
    referenceType: string;
    referenceValue: string;
    verificationStatus: string;
    timestamp: Date | string;
  }>;
};

type PublicPaymentRecord = {
  id: string;
  serviceName: string;
  providerAccount: string;
  amountTinybars: string;
  txId: string | null;
  status: string;
  createdAt: Date | string;
  serviceResultJson: string | null;
};

const asIso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const isArcTx = (value: unknown): value is string => typeof value === "string" && /^0x[a-f\d]{64}$/i.test(value);
export const isHederaTx = (value: unknown): value is string => typeof value === "string" && toMirrorTransactionId(value) !== null;
const isInferenceId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const isGenuineRequestIdSource = (value: unknown): value is string => ["x_0g_trace.request_id", "ZG-Res-Key", "body.id", "broker.chatID"].includes(String(value));
const safeProjectStatus = (value: string) => ["DRAFT", "AGREED", "FUNDED", "IN_PROGRESS", "COMPLETED", "DISPUTED"].includes(value) ? value : "UNVERIFIED";
const safeMilestoneStatus = (value: string) => ["UNFUNDED", "FUNDED", "SUBMITTED", "REVISION_REQUESTED", "APPROVED", "RELEASED", "DISPUTED", "REFUNDED"].includes(value) ? value : "UNVERIFIED";

export function publicStatus(value: unknown): PublicVerificationStatus {
  return value === "PENDING" || value === "VERIFIED" || value === "FAILED" || value === "UNVERIFIED" ? value : "UNVERIFIED";
}

export function validPublicTransactionReference(value: string): boolean {
  return isArcTx(value) || isHederaTx(value);
}

function arcStatus(events: PublicProjectRecord["proofTrackEvents"], txId: string | null): PublicVerificationStatus {
  if (!txId) return "UNVERIFIED";
  const event = events.find((e) => e.ecosystem === "ARC" && e.referenceType === "BLOCKCHAIN_TRANSACTION_HASH" && e.referenceValue.toLowerCase() === txId.toLowerCase());
  return publicStatus(event?.verificationStatus);
}

function paymentStatus(value: string, txId: string | null): PublicVerificationStatus {
  if (value === "VERIFIED" && txId && isHederaTx(txId)) return "VERIFIED";
  if (["PENDING", "VERIFICATION_PENDING"].includes(value)) return "PENDING";
  if (["FAILED_EXECUTION", "REJECTED_POLICY"].includes(value)) return "FAILED";
  return "UNVERIFIED"; // SETTLED is legacy/facilitator-only and is never publicized as verified.
}

function scanSummary(json: string | null): { high: number; medium: number; filesScanned: number } | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    const { high, medium } = parsed.summary ?? {};
    const filesScanned = parsed.filesScanned;
    if (![high, medium, filesScanned].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
    return { high, medium, filesScanned };
  } catch { return null; }
}

export function buildPublicProjectEvidence(project: PublicProjectRecord, payments: PublicPaymentRecord[]) {
  const arc: Array<{ label: string; milestoneIndex: number | null; txId: string | null; state: string; verificationStatus: PublicVerificationStatus; timestamp: string }> = [];
  const addArc = (label: string, milestoneIndex: number | null, txId: string | null, state: string, at: Date | string | null) => {
    if (txId && !isArcTx(txId)) return;
    const eventTimestamp = txId ? project.proofTrackEvents.find((e) => e.ecosystem === "ARC" && e.referenceValue.toLowerCase() === txId.toLowerCase())?.timestamp : null;
    arc.push({ label, milestoneIndex, txId, state, verificationStatus: arcStatus(project.proofTrackEvents, txId), timestamp: asIso(eventTimestamp ?? at ?? project.createdAt)! });
  };
  addArc("Project registration", null, project.registerTxHash, project.status, project.createdAt);
  const zeroG: Array<{
    requestId: string | null; requestIdSource: string | null; modelId: string | null; evaluatedAt: string;
    result: string; reportHash: string | null; status: PublicVerificationStatus;
    tee: { claim: boolean | null; source: "provider-reported" | "independently-verified" | "unverified"; status: PublicVerificationStatus };
  }> = [];
  for (const milestone of project.milestones) {
    const milestoneState = safeMilestoneStatus(milestone.state);
    addArc("Milestone registration", milestone.milestoneIndex, milestone.addTxHash, milestoneState, project.createdAt);
    addArc("Milestone funding", milestone.milestoneIndex, milestone.fundingTxHash, milestoneState, milestone.fundedAt);
    addArc("Milestone release", milestone.milestoneIndex, milestone.releaseTxHash, milestoneState, milestone.releasedAt);
    for (const submission of milestone.submissions) {
      addArc(`Submission v${submission.version}`, milestone.milestoneIndex, submission.anchorTxHash, "SUBMITTED", submission.submittedAt);
      for (const report of submission.evaluations) {
    const requestId = isInferenceId(report.inferenceRequestId) && isGenuineRequestIdSource(report.requestIdSource) ? report.inferenceRequestId : null;
        const independent = report.teeVerifiedBy === "sdk-independent" && report.teeVerified === true;
        const teeFailed = report.teeVerifiedBy === "sdk-independent" && report.teeVerified === false;
        zeroG.push({
          requestId,
          requestIdSource: requestId ? report.requestIdSource : null,
          modelId: report.modelId,
          evaluatedAt: asIso(report.createdAt)!,
          result: ["PASS", "PARTIAL", "FAIL", "UNABLE_TO_ASSESS"].includes(report.overallVerdict) ? report.overallVerdict : "UNABLE_TO_ASSESS",
          reportHash: /^[a-f\d]{64}$/i.test(report.reportHash) ? report.reportHash : null,
          status: requestId ? "PENDING" : "UNVERIFIED",
          tee: {
            claim: report.teeVerified,
            source: independent ? "independently-verified" : report.teeVerifiedBy === "router-reported" ? "provider-reported" : "unverified",
            status: independent ? "VERIFIED" : teeFailed ? "FAILED" : report.teeVerified === null ? "UNVERIFIED" : "PENDING",
          },
        });
      }
    }
  }
  const hedera = payments.map((payment) => ({
    agentReference: payment.id,
    serviceReference: payment.serviceName,
    recipientAccount: /^\d+\.\d+\.\d+$/.test(payment.providerAccount) ? payment.providerAccount : null,
    transactionId: isHederaTx(payment.txId) ? payment.txId : null,
    amountTinybars: /^\d+$/.test(payment.amountTinybars) ? payment.amountTinybars : null,
    network: "hedera:testnet" as const,
    verificationStatus: paymentStatus(payment.status, payment.txId),
    scan: payment.status === "VERIFIED" ? scanSummary(payment.serviceResultJson) : null,
    timestamp: asIso(payment.createdAt)!,
  }));
  const timeline = [
    ...arc.map((entry) => ({ category: "ARC" as const, label: entry.label, reference: entry.txId, status: entry.verificationStatus, timestamp: entry.timestamp })),
    ...zeroG.map((entry) => ({ category: "0G" as const, label: "Evaluation", reference: entry.requestId, status: entry.status, timestamp: entry.evaluatedAt })),
    ...hedera.map((entry) => ({ category: "HEDERA" as const, label: entry.serviceReference, reference: entry.transactionId, status: entry.verificationStatus, timestamp: entry.timestamp })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const referenceTypes: Record<string, ProofTrackReferenceType> = { ARC: "BLOCKCHAIN_TRANSACTION_HASH", ZERO_G: "INFERENCE_REQUEST_ID", HEDERA: "FACILITATOR_SETTLEMENT_ID" };
  const explorer = (category: "ARC" | "0G" | "HEDERA", reference: string | null) => {
    if (!reference) return null;
    return ProofTrackEngine.getExplorerUrl(category === "0G" ? "ZERO_G" : category, referenceTypes[category], reference);
  };
  return {
    project: { id: project.id, status: safeProjectStatus(project.status) },
    evidence: {
      arc: arc.map((entry) => ({ ...entry, explorerUrl: explorer("ARC", entry.txId) })),
      zeroG: zeroG.map((entry) => ({ ...entry, requestUrl: explorer("0G", entry.requestId) })),
      hedera: hedera.map((entry) => ({ ...entry, explorerUrl: explorer("HEDERA", entry.transactionId) })),
    },
    timeline,
  };
}
