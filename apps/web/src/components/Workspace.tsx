"use client";

import { AlertTriangle, Coins } from "lucide-react";
import { useReadContract } from "wagmi";
import type { ProjectResponse } from "@/hooks/useProject";
import { useEscrowTx } from "@/hooks/useEscrowTx";
import { useArcWallet } from "@/hooks/useArcWallet";
import { ARC_TESTNET_CONFIG, ERC20_ABI, fromUsdcBaseUnits } from "@/lib/arc";
import { formatUsdc } from "@/lib/format";
import type { ProjectRole } from "@/lib/authz";
import { AgreementPanel } from "./AgreementPanel";
import { Card, Empty } from "./bits";
import { MilestoneCard } from "./MilestoneCard";
import { TxStatus } from "./TxStatus";
import { FreelancerInvite } from "./FreelancerInvite";

const TITLE: Record<ProjectRole, string> = { client: "Client workspace", freelancer: "Freelancer workspace", arbiter: "Arbiter workspace" };
const ACCENT: Record<ProjectRole, string> = {
  client: "border-blue-200 bg-blue-50 text-blue-700",
  freelancer: "border-violet-200 bg-violet-50 text-violet-700",
  arbiter: "border-amber-200 bg-amber-50 text-amber-800",
};
const BLURB: Record<ProjectRole, string> = {
  client: "Register the project on Arc, approve and fund milestones, review submitted work and release funds from your own wallet.",
  freelancer: "Sign the agreement, submit deliverables (their hash is anchored on Arc) and respond to revision requests.",
  arbiter: "Resolve disputes by splitting the escrowed USDC between the parties.",
};

function UsdcBalance() {
  const w = useArcWallet();
  const bal = useReadContract({
    address: ARC_TESTNET_CONFIG.usdcContract as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: w.address ? [w.address] : undefined,
    chainId: ARC_TESTNET_CONFIG.id,
    query: { enabled: w.onArc && !!w.address },
  });
  if (!w.onArc || bal.data === undefined) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-white px-3 py-1 text-xs text-ink-2">
      <Coins className="h-3.5 w-3.5 text-royal" /> Your balance: {formatUsdc(fromUsdcBaseUnits(bal.data as bigint))} USDC
    </span>
  );
}

/** Shared workspace for one role: readiness banners, transaction status, agreement and milestones. */
export function Workspace({ detail, view }: { detail: ProjectResponse; view: ProjectRole }) {
  const tx = useEscrowTx(detail.project.id);

  if (!detail.viewer.roles.includes(view)) {
    return (
      <Empty title={`You are not the ${view} on this project`}>
        This workspace is only for the {view}'s wallet. Your role here: {detail.viewer.roles.join(", ")}. To act as the {view}, switch to that wallet and sign in again.
      </Empty>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex flex-wrap items-center gap-3 text-xl font-semibold text-ink">
            {TITLE[view]}
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ${ACCENT[view]}`}>You are the {view}</span>
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">{BLURB[view]}</p>
        </div>
        {view === "client" && <UsdcBalance />}
      </div>

      {!detail.chain.escrowAddress && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            The escrow contract is not configured on this server (<code className="mono">ESCROW_CONTRACT_ADDRESS</code> is unset), so on-chain
            actions are disabled. Agreement signing and drafting still work. Nothing is simulated.
          </p>
        </div>
      )}

      <TxStatus state={tx.state} onResync={tx.resync} onDismiss={tx.dismiss} />

      {view !== "arbiter" && <AgreementPanel detail={detail} tx={tx} />}

      {view === "client" && <FreelancerInvite project={detail.project} />}

      <div className="space-y-4">
        {detail.project.milestones.map((m) => (
          <MilestoneCard key={m.id} detail={detail} milestone={m} tx={tx} view={view} />
        ))}
      </div>

      {view === "client" && (
        <Card className="text-xs text-ink-2">
          Only your wallet can release escrowed funds. AI evaluations are advisory and are never connected to the release action.
        </Card>
      )}
      {/* keeps the last card clear of the floating transaction status */}
      {tx.state.phase !== "idle" && <div className="h-40" aria-hidden />}
    </div>
  );
}
