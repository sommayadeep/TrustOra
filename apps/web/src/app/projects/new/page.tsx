"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { isAddress } from "viem";
import { AuthGate } from "@/components/AuthGate";
import { Card } from "@/components/bits";
import { api } from "@/lib/api";
import { toUsdcBaseUnits } from "@/lib/arc";
import { errorMessage } from "@/lib/format";
import { useAuth } from "@/components/AuthProvider";

const input = "w-full rounded-lg border border-[#DCE3ED] bg-white px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-royal focus:outline-none focus:ring-2 focus:ring-[#3867F6]/15";
const label = "mb-1 block text-sm font-medium text-ink-2";

interface MilestoneRow { title: string; amount: string }

function Form() {
  const router = useRouter();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [freelancer, setFreelancer] = useState("");
  const [arbiter, setArbiter] = useState("");
  const [criteria, setCriteria] = useState("");
  const [rows, setRows] = useState<MilestoneRow[]>([{ title: "Core deliverable", amount: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let total = 0n;
  let amountsValid = true;
  for (const r of rows) {
    try { total += toUsdcBaseUnits(r.amount); if (toUsdcBaseUnits(r.amount) <= 0n) amountsValid = false; } catch { amountsValid = false; }
  }
  const totalDisplay = (Number(total) / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const freelancerOk = !freelancer || (isAddress(freelancer, { strict: false }) && freelancer.toLowerCase() !== auth.sessionAddress);
  const arbiterOk = !arbiter || isAddress(arbiter, { strict: false });
  const valid = title.trim() && description.trim() && freelancerOk && arbiterOk && amountsValid && rows.length > 0;

  if (auth.accountRole !== "CLIENT") {
    return <Card><h1 className="text-xl font-semibold text-ink">Client workspace only</h1><p className="mt-2 text-sm text-ink-2">Project creation is available to wallets registered as CLIENT. Freelancer wallets can accept invitations and submit deliverables from their dashboard.</p></Card>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const lines = criteria.split("\n").map((l) => l.trim()).filter(Boolean);
      const r = await api<{ project: { id: string } }>("/api/projects", {
        method: "POST",
        body: {
          title, description, freelancerAddress: freelancer.trim(),
          arbiterAddress: arbiter.trim() || undefined,
          budgetUsdc: (Number(total) / 1_000_000).toFixed(6),
          milestones: rows.map((m) => ({ title: m.title, amountUsdc: m.amount })),
          customCriteria: lines.length ? lines.map((text) => ({ text, category: "FUNCTIONAL", mandatory: true })) : undefined,
        },
      });
      await queryClient.invalidateQueries();
      router.push(`/projects/${r.project.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-sm text-ink-3">Projects / Create</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">Create a project</h1>
        <p className="mt-2 text-sm leading-6 text-ink-2">You will be the client. The freelancer signs the criteria before anything is registered on Arc or funded.</p>
      </div>
      <Card className="space-y-4">
        <div><label className={label} htmlFor="title">Title</label><input id="title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required /></div>
        <div><label className={label} htmlFor="desc">Scope of work</label><textarea id="desc" className={input} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} required /></div>
        <div>
          <label className={label} htmlFor="fl">Freelancer wallet address</label>
          <input id="fl" className={`${input} mono`} value={freelancer} onChange={(e) => setFreelancer(e.target.value)} placeholder="0x… (optional for marketplace publishing)" />
          {freelancer && !freelancerOk && <p className="mt-1 text-xs text-rose-300">Enter a valid address that is not your own wallet.</p>}
        </div>
        <div>
          <label className={label} htmlFor="arb">Arbiter wallet address <span className="font-normal text-ink-3">(optional; defaults to the escrow contract owner)</span></label>
          <input id="arb" className={`${input} mono`} value={arbiter} onChange={(e) => setArbiter(e.target.value)} placeholder="0x…" />
          {!arbiterOk && <p className="mt-1 text-xs text-rose-300">Not a valid address.</p>}
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ink">Milestones (USDC)</h2>
          <span className="text-sm text-ink-3">Total {totalDisplay} USDC</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input aria-label={`Milestone ${i + 1} title`} className={input} value={r.title} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder={`Milestone ${i + 1}`} maxLength={120} />
            <input aria-label={`Milestone ${i + 1} amount in USDC`} className={`${input} w-36`} inputMode="decimal" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} placeholder="250.00" />
            {rows.length > 1 && <button type="button" aria-label="Remove milestone" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="rounded-lg border border-rule px-2.5 text-ink-3 hover:text-ink"><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {rows.length < 5 && (
          <button type="button" onClick={() => setRows([...rows, { title: "", amount: "" }])} className="inline-flex items-center gap-1.5 text-sm font-medium text-royal hover:underline"><Plus className="h-4 w-4" /> Add milestone</button>
        )}
        <p className="text-xs text-ink-3">Amounts use USDC's 6 decimals. All milestones share the criteria below.</p>
      </Card>

      <Card className="space-y-2">
        <label className={label} htmlFor="crit">Acceptance criteria <span className="font-normal text-ink-3">(optional, one per line; leave empty to auto-generate from the scope)</span></label>
        <textarea id="crit" className={input} rows={5} value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder={"Responsive layout on mobile and desktop\nUnit tests cover the main flows"} />
        <p className="text-xs text-ink-3">Criteria are frozen and hashed; the hash is what gets registered on Arc.</p>
      </Card>

      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <button type="submit" disabled={!valid || busy} className="inline-flex items-center gap-2 rounded-lg bg-royal px-5 py-2.5 font-medium text-white hover:bg-royal-deep disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create project
      </button>
    </form>
  );
}

export default function NewProjectPage() {
  return <AuthGate><Form /></AuthGate>;
}
