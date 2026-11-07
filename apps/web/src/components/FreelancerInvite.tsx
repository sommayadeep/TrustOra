"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAddress } from "viem";
import { UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import type { ProjectDetail } from "@/hooks/useProject";
import { Card } from "./bits";

export function FreelancerInvite({ project }: { project: ProjectDetail }) {
  const [wallet, setWallet] = useState(project.freelancerAddress ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const client = useQueryClient();
  const agreement = project.agreementVersions[0];
  const canEdit = !project.registerTxHash && !agreement?.isLocked && !agreement?.freelancerAccepted && project.milestones.every((m) => m.state === "UNFUNDED");
  if (!canEdit) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isAddress(wallet, { strict: false })) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/projects/${project.id}/invite`, { method: "POST", body: { freelancerAddress: wallet.trim() } });
      setMessage("Freelancer assigned. Their authenticated wallet will see this invitation and can accept by signing the agreement.");
      await client.invalidateQueries();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return <Card>
    <h3 className="font-semibold text-ink">Freelancer invitation</h3>
    <p className="mt-1 text-sm text-ink-2">Assign a wallet before agreement acceptance. The invitation appears only to that wallet after it signs in.</p>
    <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor="freelancer-invite-wallet">Freelancer wallet address</label>
      <input id="freelancer-invite-wallet" value={wallet} onChange={(e)=>setWallet(e.target.value)} placeholder="0x freelancer wallet" className="min-w-0 flex-1 rounded-lg border border-[#DCE3ED] bg-white px-3 py-2.5 mono text-sm text-ink placeholder:text-ink-3 focus:border-royal focus:outline-none focus:ring-2 focus:ring-[#3867F6]/15" />
      <button disabled={!isAddress(wallet,{strict:false}) || busy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-royal px-4 py-2.5 text-sm font-semibold text-white hover:bg-royal-deep disabled:opacity-50"><UserPlus className="h-4 w-4"/>{busy?"Sending…":"Assign freelancer"}</button>
    </form>
    {message && <p role="status" className="mt-3 text-sm text-ok">{message}</p>}{error && <p role="alert" className="mt-3 text-sm text-risk">{error}</p>}
  </Card>;
}
