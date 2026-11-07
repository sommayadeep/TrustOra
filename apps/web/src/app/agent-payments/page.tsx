"use client";

import { ArrowLeft, CircleSlash, Clock3, ShieldCheck, Search, Bot } from "lucide-react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { Card } from "@/components/bits";
import { useSystemStatus } from "@/hooks/useSystemStatus";
import { useEffect, useState } from "react";

type Payment = {
  id: string;
  serviceName: string;
  amountTinybars: string;
  status: string;
  txId: string | null;
  hashscanUrl: string | null;
  createdAt: string;
  projectId?: string | null;
  serviceResultJson?: string | null;
};
type Service = { id: string; name: string; endpoint: string; recipient: string; amountTinybars: string; network: string; asset: string; description: string };
type ProjectChoice = { id: string; title: string };
type AgentActivity = { step: string; status: "OK" | "REJECTED" | "PENDING"; detail: string };

function formatHbar(tinybars: string): string {
  if (!/^\d+$/.test(tinybars)) return `${tinybars} tinybars`;
  const amount = BigInt(tinybars);
  const whole = amount / 100_000_000n;
  const fraction = (amount % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} HBAR`;
}

function paymentStatus(status: string): { label: string; className: string } {
  switch (status) {
    case "VERIFIED": return { label: "Verified on Hedera Mirror Node", className: "bg-emerald-50 text-emerald-700" };
    case "VERIFICATION_PENDING": return { label: "Facilitator reported settlement · Mirror Node pending", className: "bg-amber-50 text-amber-700" };
    case "SETTLED": return { label: "Settlement reported · legacy status", className: "bg-amber-50 text-amber-700" };
    case "PENDING": return { label: "Pending", className: "bg-slate-100 text-slate-700" };
    case "REJECTED_POLICY": return { label: "Rejected by payment policy", className: "bg-red-50 text-red-700" };
    case "FAILED_EXECUTION": return { label: "Settlement failed or verification mismatch", className: "bg-red-50 text-red-700" };
    case "NOT_CONFIGURED": return { label: "Not configured · no payment sent", className: "bg-slate-100 text-slate-700" };
    default: return { label: status.replaceAll("_", " "), className: "bg-slate-100 text-slate-700" };
  }
}

function AgentPayments() {
  const status = useSystemStatus();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [projects, setProjects] = useState<ProjectChoice[]>([]);
  const [projectId, setProjectId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [agentPolicy, setAgentPolicy] = useState<{ autonomousEnabled: boolean; requireApproval: boolean } | null>(null);
  const [agentActivity, setAgentActivity] = useState<AgentActivity[]>([]);
  const [filesJson, setFilesJson] = useState('{"src/example.ts":"const result = eval(userInput);"}');
  const [requirement, setRequirement] = useState<Service | null>(null);
  const [flowMessage, setFlowMessage] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [scanResult, setScanResult] = useState<{ filesScanned: number; findings: Array<{ ruleId: string; severity: string; file: string; line: number; message: string }> } | null>(null);
  const [policy, setPolicy] = useState<{ maxPaymentTinybars: string; maxDailyBudgetTinybars: string; spentTinybars: string; remainingDailyTinybars: string } | null>(null);

  async function refreshHistory() {
    const response = await fetch("/api/agent-payments");
    const body = await response.json();
    setScanResult(body.result ?? null);
    if (!response.ok || !body.success) throw new Error(body.error ?? "Unable to load payment history");
    setPayments(body.payments);
    setPolicy(body.policy);
  }

  useEffect(() => {
    setAgentName(localStorage.getItem("trustora-agent-name") ?? "Security agent");
    Promise.all([refreshHistory(), fetch("/api/agent-services").then((r) => r.json()).then((b) => { if (b.success) { setServices(b.services); setServiceId(b.services[0]?.id ?? ""); setAgentPolicy(b.agentPolicy ?? null); } }), fetch("/api/projects").then((r) => r.json()).then((b) => { if (b.success) { setProjects(b.projects); setProjectId(b.projects[0]?.id ?? ""); } })])
      .catch((error) => setHistoryError(error instanceof Error ? error.message : "Unable to load payment history"));
  }, []);

  const selectedService = services.find((service) => service.id === serviceId) ?? null;
  async function inspectRequirement() {
    if (!selectedService) return;
    const response = await fetch(`/api/agent-services/${selectedService.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    const raw = response.headers.get("PAYMENT-REQUIRED");
    setRequirement(selectedService);
    setFlowMessage(response.status === 402 && raw ? "Service returned x402 payment requirement (HTTP 402). Review exact terms before authorizing." : `Service response: HTTP ${response.status}`);
  }
  async function executeService() {
    if (!selectedService || !agentPolicy?.autonomousEnabled || (agentPolicy.requireApproval && !authorized)) return;
    let files: Record<string, string>;
    try { files = JSON.parse(filesJson); } catch { setFlowMessage("Files must be valid JSON mapping paths to source text."); return; }
    setAgentActivity([{ step: "service request", status: "PENDING", detail: "Requesting the service and waiting for its x402 payment requirements." }]);
    const response = await fetch(`/api/agent-services/${selectedService.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ autonomous: true, consent: authorized, files, ...(projectId ? { projectId } : {}) }) });
    const body = await response.json();
    setAgentActivity(Array.isArray(body.agentActivity) ? body.agentActivity : [{ step: "agent", status: "REJECTED", detail: body.error ?? "No agent activity details returned." }]);
    setFlowMessage(body.result ? `Scan complete: ${body.result.filesScanned} file(s), ${body.result.findings.length} finding(s).` : body.error ?? `Payment status: ${body.status ?? response.status}`);
    await refreshHistory();
  }
  async function reconcilePending() {
    setReconciling(true);
    try {
      const response = await fetch("/api/agent-payments/reconcile", { method: "POST" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error ?? "Unable to reconcile payments");
      setFlowMessage(`Reconciliation checked ${body.updates.length} pending payment(s).`);
      await refreshHistory();
    } catch (error) { setFlowMessage(error instanceof Error ? error.message : "Unable to reconcile payments"); }
    finally { setReconciling(false); }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-[#3867F6] hover:underline"><ArrowLeft className="h-4 w-4"/> Dashboard</Link>
      <header>
        <p className="text-sm font-medium text-[#3867F6]">Hedera Testnet · x402 v2 exact · HBAR</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#172B4D]">Agent Payments</h1>
        <p className="mt-2 max-w-2xl text-slate-600">The server-side agent discovers the selected service, checks its x402 terms and budget, and uses a dedicated Hedera testnet wallet when autonomous payments are enabled.</p>
      </header>
      <Card>
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-amber-50 p-2 text-amber-700"><CircleSlash className="h-5 w-5"/></div>
          <div>
            <h2 className="font-semibold text-[#172B4D]">{status.data?.hedera.status === "CONFIGURED" ? "Configuration detected" : "Settlement unavailable"}</h2>
            <p className="mt-1 text-sm text-slate-600">{status.data?.hedera.detail ?? "Checking integration status…"}</p>
          </div>
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card><ShieldCheck className="h-5 w-5 text-[#3867F6]"/><h2 className="mt-3 font-semibold text-[#172B4D]">Payment safeguards</h2><p className="mt-1 text-sm leading-6 text-slate-600">The protected testnet endpoint requires payer-signed x402 v2 exact terms, an explicit consent flag, policy approval, persistent spend reservation, facilitator verification and settlement, then Mirror Node verification.</p></Card>
        <Card><Clock3 className="h-5 w-5 text-[#3867F6]"/><h2 className="mt-3 font-semibold text-[#172B4D]">Settlement history</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">Only persistent payment records are shown. A payment is verified only after the Mirror Node confirms the exact transfer.</p>
          <button className="mt-3 rounded border px-3 py-2 text-sm disabled:opacity-50" disabled={reconciling} onClick={reconcilePending}>{reconciling ? "Checking Mirror Node…" : "Reconcile pending payments"}</button>
          {historyError && <p className="mt-3 text-sm text-red-600">{historyError}</p>}
          {payments.length === 0 && !historyError && <p className="mt-3 text-sm text-slate-500">No agent payments recorded.</p>}
          <div className="mt-3 space-y-2">
            {payments.map((payment) => <div key={payment.id} className="rounded border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3"><span className="font-medium">{payment.serviceName}</span><span className={`rounded-full px-2 py-1 text-xs font-semibold ${paymentStatus(payment.status).className}`}>{paymentStatus(payment.status).label}</span></div>
              <p className="mt-1 text-slate-500">{formatHbar(payment.amountTinybars)} · {new Date(payment.createdAt).toLocaleString()}</p>
              {payment.projectId && <p className="text-xs text-slate-500">ProofTrack project: {payment.projectId}</p>}
              {payment.serviceResultJson && <p className="mt-2 text-xs text-slate-600">Scan result: {JSON.parse(payment.serviceResultJson).filesScanned} file(s), {JSON.parse(payment.serviceResultJson).findings.length} finding(s)</p>}
              {payment.hashscanUrl && <a className="text-[#3867F6] hover:underline" href={payment.hashscanUrl} target="_blank" rel="noreferrer">View facilitator transaction ID on HashScan{payment.status === "VERIFIED" ? " · verified" : " · not independently verified"}</a>}
            </div>)}
          </div>
        </Card>
      </div>
      <Card>
        <div className="flex items-center gap-2"><Bot className="h-5 w-5 text-[#3867F6]"/><h2 className="font-semibold text-[#172B4D]">Register and select agent</h2></div>
        <p className="mt-1 text-sm text-slate-600">Give this local agent profile a display name. Payment signing uses a separate server-configured Hedera testnet agent account; your TRUSTORA session wallet is never used for HBAR payments.</p>
        <div className="mt-3 flex flex-wrap gap-2"><input className="min-w-48 rounded border px-3 py-2 text-sm" value={agentName} onChange={(e) => setAgentName(e.target.value)} onBlur={() => localStorage.setItem("trustora-agent-name", agentName)} aria-label="Agent name"/><span className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">{agentPolicy?.autonomousEnabled ? "Dedicated testnet agent configured" : "Autonomous agent wallet not configured"}</span></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm">Discoverable service<select className="mt-1 block w-full rounded border px-3 py-2" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setRequirement(null); }}><option value="">No configured services</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <div className="rounded bg-slate-50 p-3 text-sm"><div>Per payment limit: 1 HBAR</div><div>Rolling 24 hour limit: 5 HBAR</div><div>Spent: {policy ? formatHbar(policy.spentTinybars) : "Loading…"} · remaining: {policy ? formatHbar(policy.remainingDailyTinybars) : "Loading…"}</div></div>
        </div>
        {selectedService && <div className="mt-3 rounded border border-slate-200 p-3 text-sm"><div className="font-medium">{selectedService.name}</div><div>Price: {formatHbar(selectedService.amountTinybars)} · Network: {selectedService.network} · Recipient: {selectedService.recipient}</div><p className="mt-1 text-slate-500">{selectedService.description}</p><button className="mt-2 inline-flex items-center gap-2 rounded bg-[#3867F6] px-3 py-2 text-white" onClick={inspectRequirement}><Search className="h-4 w-4"/>Show x402 requirement</button></div>}
        {projects.length > 0 && <label className="mt-3 block text-sm">Link result to ProofTrack project<select className="mt-1 block w-full rounded border px-3 py-2" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">No project link</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>}
        {requirement && <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm"><strong>Payment requirement</strong><div>exact · {requirement.network} · {requirement.asset} · {formatHbar(requirement.amountTinybars)} · pay to {requirement.recipient}</div></div>}
        <label className="mt-4 block text-sm">Source files to scan (JSON)<textarea className="mt-1 min-h-24 w-full rounded border p-2 font-mono text-xs" value={filesJson} onChange={(e) => setFilesJson(e.target.value)}/></label>
        {agentPolicy?.requireApproval && <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)}/><span>I approve this payment under the displayed service terms. The 1 HBAR per-payment and 5 HBAR rolling 24-hour caps still apply.</span></label>}
        {agentPolicy && !agentPolicy.requireApproval && <p className="mt-3 rounded bg-emerald-50 p-3 text-sm text-emerald-800">Policy permits autonomous payment without per-request approval. The agent still validates the challenge, allowlist and budget before signing.</p>}
        <button disabled={!agentPolicy?.autonomousEnabled || (agentPolicy.requireApproval && !authorized) || !selectedService} className="mt-3 rounded bg-[#172B4D] px-4 py-2 text-white disabled:opacity-40" onClick={executeService}>Request paid security scan</button>
        {flowMessage && <p className="mt-3 text-sm text-slate-700" role="status">{flowMessage}</p>}
        {agentActivity.length > 0 && <div className="mt-3 rounded border border-slate-200 p-3"><h3 className="font-medium">Agent activity</h3><ol className="mt-2 space-y-2 text-sm">{agentActivity.map((entry, index) => <li key={`${entry.step}-${index}`}><span className={`mr-2 inline-block rounded px-2 py-0.5 text-xs ${entry.status === "OK" ? "bg-emerald-50 text-emerald-700" : entry.status === "REJECTED" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{entry.status}</span><strong>{entry.step}</strong> — {entry.detail}</li>)}</ol></div>}
        {scanResult && <div className="mt-3 rounded border border-slate-200 p-3"><h3 className="font-medium">Security scan result · {scanResult.filesScanned} file(s)</h3>{scanResult.findings.length ? <ul className="mt-2 space-y-2 text-sm">{scanResult.findings.map((finding, i) => <li key={`${finding.ruleId}-${i}`}><strong>{finding.severity} · {finding.ruleId}</strong> · {finding.file}:{finding.line} — {finding.message}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-700">No findings for the included checks.</p>}</div>}
      </Card>
    </div>
  );
}

export default function AgentPaymentsPage() {
  return <AuthGate><AgentPayments /></AuthGate>;
}
