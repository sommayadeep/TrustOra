"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import type { ProjectRole } from "@/lib/authz";

export interface ProjectDetail {
  id: string;
  title: string;
  description: string;
  clientAddress: string;
  freelancerAddress: string | null;
  arbiterAddress: string | null;
  status: string;
  budgetUsdc: number;
  escrowContractAddress: string | null;
  registerTxHash: string | null;
  createdAt: string;
  publishedAt: string | null;
  agreementVersions: Array<{
    id: string; versionNumber: number; criteriaJson: string; criteriaHash: string;
    clientAccepted: boolean; freelancerAccepted: boolean; isLocked: boolean;
  }>;
  milestones: Array<{
    id: string; milestoneIndex: number; title: string; description: string | null; amountUsdc: number; state: string;
    criteriaHash: string | null; addTxHash: string | null; fundingTxHash: string | null; releaseTxHash: string | null;
    submissions: Array<{
      id: string; version: number; deliverableHash: string; deliverableUri: string | null; content: string | null; anchorTxHash: string | null;
      notes: string | null; submittedAt: string;
      evaluations: Array<{
        id: string; overallVerdict: string; inferenceRequestId: string | null; requestIdSource: string | null;
        teeVerified: boolean | null; teeVerifiedBy: string | null; modelId: string | null;
        providerAddress: string | null;
        criteriaResultsJson: string; findingsJson: string; reportHash: string; advisoryNotice: string; createdAt: string;
      }>;
    }>;
  }>;
  proofTrackEvents: Array<{
    id: string; sequence: number; ecosystem: string; eventType: string; referenceType: string;
    referenceValue: string; explorerUrl: string | null; verificationStatus: string; timestamp: string;
  }>;
}

export interface ProjectResponse {
  success: true;
  project: ProjectDetail;
  viewer: { address: string; roles: ProjectRole[] };
  chain: { escrowAddress: string | null };
}

/** Loads a project for the signed-in wallet. The server decides visibility; non-participants get 404. */
export function useProject(id: string) {
  const auth = useAuth();
  return useQuery({
    queryKey: ["project", id, auth.sessionAddress],
    queryFn: () => api<ProjectResponse>(`/api/projects/${id}`),
    enabled: auth.status === "authenticated" && !auth.walletMismatch,
  });
}
