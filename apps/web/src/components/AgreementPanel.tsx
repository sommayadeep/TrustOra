"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import { CheckCircle2, Circle, FileSignature, Loader2, PenLine } from "lucide-react";
import type { ProjectResponse } from "@/hooks/useProject";
import type { useEscrowTx } from "@/hooks/useEscrowTx";
import { useWorkflowWallet } from "@/hooks/useWorkflowWallet";
import { api } from "@/lib/api";
import { TRUSTORA_ESCROW_ABI, projectIdToBytes32 } from "@/lib/arc";
import { errorMessage, shortAddress } from "@/lib/format";
import { buildAgreementMessage } from "@/lib/siwe";
import { projectActions } from "@/lib/workflow";
import { Card, TxLink } from "./bits";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

interface Criterion { id: string; text: string; category: string; mandatory: boolean }

/** Frozen acceptance criteria, signature status, freelancer acceptance and the client's on-chain project registration. */
export function AgreementPanel({ detail, tx }: { detail: ProjectResponse; tx: ReturnType<typeof useEscrowTx> }) {
  const { project } = detail;
  const agreement = project.agreementVersions[0];
  const { ctx } = useWorkflowWallet(detail);
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!agreement) return null;

  let criteria: Criterion[] = [];
  try { criteria = JSON.parse(agreement.criteriaJson) as Criterion[]; } catch { /* shown as empty */ }

  const actions = projectActions(
    { status: project.status, registerTxHash: project.registerTxHash, agreement, milestones: [] },
    ctx,
  );
  const accept = actions.find((a) => a.id === "accept_agreement");
  const register = actions.find((a) => a.id === "register_project");

  async function acceptAgreement() {
    setBusy(true);
    setError(null);
    try {
      const message = buildAgreementMessage({ projectId: project.id, versionNumber: agreement!.versionNumber, criteriaHash: agreement!.criteriaHash, role: "FREELANCER" });
      const signature = await signMessageAsync({ message });
      await api(`/api/projects/${project.id}/agreements/accept`, { method: "POST", body: { signature } });
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function registerProject() {
    void tx.run("Register project on Arc", async () => ({
      write: {
        address: detail.chain.escrowAddress as `0x${string}`,
        abi: TRUSTORA_ESCROW_ABI,
        functionName: "createProject",
        args: [projectIdToBytes32(project.id), project.freelancerAddress as `0x${string}`, (project.arbiterAddress ?? ZERO) as `0x${string}`],
      },
      syncPath: `/api/projects/${project.id}/register`,
    }));
  }

  const Step = ({ done, children }: { done: boolean; children: React.ReactNode }) => (
    <li className="flex items-center gap-2 text-sm">
      {done ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Circle className="h-4 w-4 text-ink-3" />}
      <span className={done ? "text-ink-2" : "text-ink-3"}>{children}</span>
    </li>
  );

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><FileSignature className="h-5 w-5 text-royal" /> Agreement v{agreement.versionNumber}</h2>
        <span className="mono text-xs text-ink-3" title={agreement.criteriaHash}>criteria hash {agreement.criteriaHash.slice(0, 14)}…</span>
      </div>

      <ol className="mb-5 grid gap-1.5 sm:grid-cols-2">
        <Step done={agreement.clientAccepted}>Client accepted ({shortAddress(project.clientAddress)})</Step>
        <Step done={agreement.freelancerAccepted}>Freelancer signed ({shortAddress(project.freelancerAddress)})</Step>
        <Step done={agreement.isLocked}>Criteria frozen</Step>
        <Step done={!!project.registerTxHash}>Project registered on Arc {project.registerTxHash && <TxLink hash={project.registerTxHash} />}</Step>
      </ol>

      <ul className="space-y-2">
        {criteria.map((c) => (
          <li key={c.id} className="flex items-start gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <span className="mt-0.5 rounded border border-rule px-1.5 text-[10px] uppercase tracking-wide text-ink-3">{c.category}</span>
            <span className="text-ink-2">{c.text}</span>
            {c.mandatory && <span className="ml-auto shrink-0 text-[10px] uppercase text-warn">mandatory</span>}
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {accept && (
          <button onClick={acceptAgreement} disabled={!accept.available || busy || tx.busy} title={accept.reason} className="inline-flex items-center gap-2 rounded-lg bg-arc-blue px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Sign and accept agreement
          </button>
        )}
        {register && (
          <button onClick={registerProject} disabled={!register.available || tx.busy} title={register.reason} className="inline-flex items-center gap-2 rounded-lg bg-arc-blue px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            Register project on Arc
          </button>
        )}
        {register && !register.available && register.reason && <span className="text-xs text-ink-3">{register.reason}</span>}
        {accept && !accept.available && accept.reason && <span className="text-xs text-ink-3">{accept.reason}</span>}
      </div>
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      <p className="mt-4 text-xs text-ink-3">Signing accepts these criteria only. It does not authorize any transaction or movement of funds.</p>
    </Card>
  );
}
