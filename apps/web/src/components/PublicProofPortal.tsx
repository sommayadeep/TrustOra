"use client";

import { useEffect, useState } from "react";
import { Card, ErrorState, PageSkeleton } from "@/components/bits";

type Status = "PENDING" | "VERIFIED" | "FAILED" | "UNVERIFIED";
type Bundle = {
  project: { id: string; status: string };
  evidence: {
    arc: Array<{ label: string; milestoneIndex: number | null; txId: string | null; state: string; verificationStatus: Status; timestamp: string; explorerUrl: string | null }>;
    zeroG: Array<{ requestId: string | null; requestIdSource: string | null; modelId: string | null; evaluatedAt: string; result: string; reportHash: string | null; status: Status; tee: { claim: boolean | null; source: string; status: Status }; requestUrl: string | null }>;
    hedera: Array<{ agentReference: string; serviceReference: string; recipientAccount: string | null; transactionId: string | null; amountTinybars: string | null; network: string; verificationStatus: Status; scan: { high: number; medium: number; filesScanned: number } | null; timestamp: string; explorerUrl: string | null }>;
  };
  timeline: Array<{ category: "ARC" | "0G" | "HEDERA"; label: string; reference: string | null; status: Status; timestamp: string }>;
};

const statusTone: Record<Status, string> = {
  PENDING: "bg-amber-50 text-amber-800",
  VERIFIED: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-700",
  UNVERIFIED: "bg-slate-100 text-slate-700",
};
const formatDate = (date: string) => new Date(date).toLocaleString();
const formatTinybars = (value: string | null) => {
  if (!value || !/^\d+$/.test(value)) return "Not recorded";
  const amount = BigInt(value);
  const fraction = (amount % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${amount / 100_000_000n}${fraction ? `.${fraction}` : ""} HBAR`;
};
function StatusBadge({ status }: { status: Status }) {
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${statusTone[status]}`}>{status}</span>;
}
function CategoryTitle({ title, count }: { title: string; count: number }) {
  return <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-[#172B4D]">{title}</h2><span className="text-xs text-slate-500">{count} record(s)</span></div>;
}

export function PublicProofPortal({ mode, reference }: { mode: "project" | "transaction"; reference: string }) {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const params = new URLSearchParams(mode === "project" ? { project: reference } : { transaction: reference });
    fetch(`/api/public/prooftrack?${params.toString()}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error ?? "Unable to load public evidence");
        setBundles(body.projects);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load public evidence"))
      .finally(() => setLoading(false));
  }, [mode, reference]);

  if (loading) return <main className="mx-auto max-w-5xl space-y-5 p-6"><PageSkeleton rows={4}/></main>;
  if (error) return <main className="mx-auto max-w-5xl p-6"><ErrorState title="Verification record unavailable" message={error}/></main>;
  return <main className="mx-auto max-w-5xl space-y-6 p-5 sm:p-8">
    <header>
      <p className="text-sm font-medium text-[#3867F6]">TRUSTORA · Public read-only record</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#172B4D]">ProofTrack verification portal</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">No wallet connection is required. This page shows published project evidence only. VERIFIED means the recorded verifier confirmed the evidence; provider-reported metadata is labeled separately.</p>
    </header>
    {bundles.map((bundle) => <section key={bundle.project.id} className="space-y-5">
      <Card><div className="text-xs uppercase tracking-wide text-slate-500">Project reference</div><div className="mt-1 flex flex-wrap items-center justify-between gap-3"><span className="font-mono text-lg font-semibold text-[#172B4D]">{bundle.project.id}</span><span className="rounded bg-slate-100 px-2 py-1 text-xs">Project state · {bundle.project.status}</span></div></Card>
      <Card><CategoryTitle title="ARC · Escrow evidence" count={bundle.evidence.arc.length}/>
        {bundle.evidence.arc.length === 0 ? <p className="mt-3 text-sm text-slate-500">No ARC evidence recorded. Status: UNVERIFIED.</p> : <ul className="mt-3 divide-y divide-slate-100">{bundle.evidence.arc.map((item, index) => <li key={`${item.label}-${item.txId}-${index}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><div className="font-medium text-slate-800">{item.label}{item.milestoneIndex ? ` · milestone ${item.milestoneIndex}` : ""}</div><div className="mt-1 text-xs text-slate-500">State: {item.state} · {formatDate(item.timestamp)}</div>{item.txId ? <><a className="mt-1 block break-all font-mono text-xs text-[#3867F6] hover:underline" href={item.explorerUrl ?? `/verify/transaction/${encodeURIComponent(item.txId)}`} target={item.explorerUrl ? "_blank" : undefined} rel={item.explorerUrl ? "noreferrer" : undefined}>{item.txId}</a><a className="mt-1 inline-block text-xs text-[#3867F6] hover:underline" href={`/verify/transaction/${encodeURIComponent(item.txId)}`}>Open public verification record</a></> : <span className="mt-1 block text-xs text-slate-500">No transaction ID recorded</span>}</div><StatusBadge status={item.verificationStatus}/></li>)}</ul>}
      </Card>
      <Card><CategoryTitle title="0G · Evaluation evidence" count={bundle.evidence.zeroG.length}/>
        {bundle.evidence.zeroG.length === 0 ? <p className="mt-3 text-sm text-slate-500">No 0G evaluation evidence recorded. Status: UNVERIFIED.</p> : <ul className="mt-3 divide-y divide-slate-100">{bundle.evidence.zeroG.map((item, index) => <li key={`${item.requestId}-${index}`} className="py-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-3"><strong>{item.result}</strong><StatusBadge status={item.status}/></div><dl className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2"><div><dt className="inline font-medium">Provider request ID: </dt><dd className="inline break-all font-mono">{item.requestId ?? "Not recorded"}</dd>{item.requestIdSource && <span> · source: {item.requestIdSource}</span>}</div><div><dt className="inline font-medium">Model: </dt><dd className="inline">{item.modelId ?? "Not recorded"}</dd></div><div><dt className="inline font-medium">Evaluated: </dt><dd className="inline">{formatDate(item.evaluatedAt)}</dd></div><div><dt className="inline font-medium">Report hash: </dt><dd className="inline break-all font-mono">{item.reportHash ?? "Unavailable · UNVERIFIED"}</dd></div></dl><div className="mt-2 rounded bg-slate-50 p-2 text-xs"><span className="font-medium">TEE attestation: </span>{item.tee.source === "independently-verified" ? "Independently verified by SDK" : item.tee.source === "provider-reported" ? `Provider-reported claim: ${item.tee.claim ? "verified" : "not verified"}; not independently confirmed` : "No attestation evidence"} <StatusBadge status={item.tee.status}/></div></li>)}</ul>}
      </Card>
      <Card><CategoryTitle title="HEDERA · Agent payments" count={bundle.evidence.hedera.length}/>
        {bundle.evidence.hedera.length === 0 ? <p className="mt-3 text-sm text-slate-500">No Hedera payment evidence recorded. Status: UNVERIFIED.</p> : <ul className="mt-3 divide-y divide-slate-100">{bundle.evidence.hedera.map((item) => <li key={item.agentReference} className="py-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-3"><strong>{item.serviceReference}</strong><StatusBadge status={item.verificationStatus}/></div><dl className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2"><div><dt className="inline font-medium">Agent payment reference: </dt><dd className="inline font-mono">{item.agentReference}</dd></div><div><dt className="inline font-medium">Network: </dt><dd className="inline">{item.network}</dd></div><div><dt className="inline font-medium">Recipient: </dt><dd className="inline">{item.recipientAccount ?? "Not recorded"}</dd></div><div><dt className="inline font-medium">Amount: </dt><dd className="inline">{formatTinybars(item.amountTinybars)}</dd></div><div><dt className="inline font-medium">Transaction ID: </dt><dd className="inline break-all font-mono">{item.transactionId ?? "Not recorded · UNVERIFIED"}</dd></div><div><dt className="inline font-medium">Recorded: </dt><dd className="inline">{formatDate(item.timestamp)}</dd></div></dl>{item.explorerUrl && <a className="mt-1 inline-block text-xs text-[#3867F6] hover:underline" href={item.explorerUrl} target="_blank" rel="noreferrer">Open HashScan</a>}{item.transactionId && <a className="ml-3 mt-1 inline-block text-xs text-[#3867F6] hover:underline" href={`/verify/transaction/${encodeURIComponent(item.transactionId)}`}>Open public verification record</a>}{item.scan && <div className="mt-2 rounded bg-slate-50 p-2 text-xs">Security scan: {item.scan.filesScanned} files · {item.scan.high} high · {item.scan.medium} medium finding(s)</div>}</li>)}</ul>}
      </Card>
      <Card><CategoryTitle title="Unified evidence timeline" count={bundle.timeline.length}/>
        {bundle.timeline.length === 0 ? <p className="mt-3 text-sm text-slate-500">No evidence events to display.</p> : <ol className="mt-3 space-y-3">{bundle.timeline.map((entry, index) => <li key={`${entry.category}-${entry.timestamp}-${index}`} className="flex flex-wrap items-start justify-between gap-3 border-l-2 border-slate-200 pl-3 text-sm"><div><div className="font-medium">{entry.category} · {entry.label}</div><time className="text-xs text-slate-500">{formatDate(entry.timestamp)}</time>{entry.reference && <code className="mt-1 block break-all text-xs text-slate-600">{entry.reference}</code>}</div><StatusBadge status={entry.status}/></li>)}</ol>}
      </Card>
    </section>)}
    <footer className="text-xs text-slate-500">Public evidence omits wallet owner addresses, credentials, signatures, deliverable contents, project descriptions and detailed evaluation findings.</footer>
  </main>;
}
