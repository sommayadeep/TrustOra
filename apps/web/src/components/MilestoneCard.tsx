"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useReadContract } from "wagmi";
import { Bot, CheckCircle2, ChevronDown, Gavel, Loader2, RotateCcw, Send, Undo2, Unlock, Wallet } from "lucide-react";
import type { ProjectResponse } from "@/hooks/useProject";
import type { useEscrowTx } from "@/hooks/useEscrowTx";
import { useWorkflowWallet } from "@/hooks/useWorkflowWallet";
import { api } from "@/lib/api";
import { ARC_TESTNET_CONFIG, ERC20_ABI, TRUSTORA_ESCROW_ABI, criteriaHashToBytes32, projectIdToBytes32, toUsdcBaseUnits } from "@/lib/arc";
import { errorMessage, formatUsdc } from "@/lib/format";
import { milestoneActions, statusNote, type ActionId } from "@/lib/workflow";
import { MAX_DELIVERABLE_CHARS } from "@/lib/limits";
import { useSystemStatus } from "@/hooks/useSystemStatus";
import type { ProjectRole } from "@/lib/authz";
import { Card, StateBadge, TxLink } from "./bits";
import { EvaluationPanel } from "./EvaluationPanel";

type Milestone = ProjectResponse["project"]["milestones"][number];

/** Actions worth showing (even when blocked, with the reason) for each milestone state. */
const RELEVANT: Record<string, ActionId[]> = {
  UNFUNDED: ["register_milestone", "approve_usdc", "fund", "submit"],
  FUNDED: ["submit", "dispute", "refund"],
  SUBMITTED: ["evaluate", "request_revision", "release", "dispute", "refund"],
  REVISION_REQUESTED: ["submit", "dispute", "refund"],
  DISPUTED: ["resolve"],
};

const input = "w-full rounded-lg border border-[#DCE3ED] bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-royal focus:outline-none focus:ring-2 focus:ring-[#3867F6]/15";
const btnBase = "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45";
const primary = `${btnBase} bg-arc-blue text-white hover:bg-blue-500`;
const subtle = `${btnBase} border border-[#DCE3ED] text-ink-2 hover:bg-surface-2`;
const danger = `${btnBase} border border-risk/30 text-risk hover:bg-rose-50`;

function Stepper({ m }: { m: Milestone }) {
  const order = ["UNFUNDED", "FUNDED", "SUBMITTED", "RELEASED"];
  const reached = m.state === "REVISION_REQUESTED" ? 2 : m.state === "DISPUTED" ? 2 : Math.max(0, order.indexOf(m.state));
  const labels = ["Registered", "Funded", "Submitted", "Released"];
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="Milestone progress">
      {labels.map((l, i) => {
        const done = i === 0 ? !!m.addTxHash : i <= reached && m.state !== "REFUNDED";
        return (
          <li key={l} className="flex items-center gap-2">
              <span className={`flex items-center gap-1 ${done ? "text-ok" : "text-ink-3"}`}>
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5 rounded-full border border-slate-600" />} {l}
            </span>
            {i < labels.length - 1 && <span className="h-px w-5 bg-surface-3" />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One milestone with the actions the connected wallet is entitled to. Every fund-moving button opens the
 * user's wallet to sign; the server then verifies the receipt. Release is a client-only wallet transaction:
 * the AI evaluation shown here is advisory and has no path to move funds.
 */
export function MilestoneCard({ detail, milestone: m, tx, view }: {
  detail: ProjectResponse;
  milestone: Milestone;
  tx: ReturnType<typeof useEscrowTx>;
  view: ProjectRole;
}) {
  const { project } = detail;
  const escrow = detail.chain.escrowAddress as `0x${string}` | null;
  const amountUnits = toUsdcBaseUnits(String(m.amountUsdc));
  const queryClient = useQueryClient();

  const base = useWorkflowWallet(detail);
  const address = base.wallet.address;
  const isClient = view === "client";
  const allowance = useReadContract({
    address: ARC_TESTNET_CONFIG.usdcContract as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && escrow ? [address, escrow] : undefined,
    chainId: ARC_TESTNET_CONFIG.id,
    query: { enabled: isClient && !!address && !!escrow && base.wallet.onArc },
  });
  const { ctx } = useWorkflowWallet(detail, { allowanceUnits: (allowance.data as bigint | undefined) ?? null, amountUnits });

  const systemStatus = useSystemStatus();
  const zeroGReady = systemStatus.data?.zeroG.status === "CONFIGURED";

  const [open, setOpen] = useState<"submit" | "revision" | "dispute" | "resolve" | "evaluate" | null>(null);
  const [reason, setReason] = useState("");
  const [content, setContent] = useState("");
  const [uri, setUri] = useState("");
  const [consent, setConsent] = useState(false);
  const [releaseAmt, setReleaseAmt] = useState("");
  const [refundAmt, setRefundAmt] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const wf = { status: project.status, registerTxHash: project.registerTxHash, agreement: project.agreementVersions[0] ?? null, milestones: project.milestones };
  const all = milestoneActions(wf, m, ctx).filter((a) => a.role === view);
  const shown = all.filter((a) => a.available || (RELEVANT[m.state] ?? []).includes(a.id));
  const get = (id: ActionId) => all.find((a) => a.id === id);

  const pid = projectIdToBytes32(project.id);
  const idx = BigInt(m.milestoneIndex);
  const syncBase = `/api/projects/${project.id}/milestones/${m.id}`;
  const write = (functionName: string, args: readonly unknown[]) => ({
    address: escrow as `0x${string}`, abi: TRUSTORA_ESCROW_ABI as readonly unknown[], functionName, args,
  });
  const send = (label: string, functionName: string, args: readonly unknown[], path: string, body: Record<string, unknown> = {}) =>
    tx.run(label, async () => ({ write: write(functionName, args), syncPath: `${syncBase}/${path}`, syncBody: body }));

  const latest = m.submissions[0];
  const latestEval = latest?.evaluations[0];
  const disabled = (id: ActionId) => !get(id)?.available || tx.busy;

  async function runEvaluation() {
    setEvaluating(true);
    setLocalError(null);
    try {
      await api(`${syncBase}/evaluate`, { method: "POST", body: { aiConsent: true } });
      await queryClient.invalidateQueries();
      setOpen(null);
    } catch (e) {
      setLocalError(errorMessage(e));
    } finally {
      setEvaluating(false);
    }
  }

  function submitWork() {
    void tx.run("Submit deliverable on Arc", async () => {
      // 1) store the text off-chain and get the hash to anchor; state does not change yet
      const stored = await api<{ submission: { id: string; deliverableUri: string | null }; anchor: { deliverableHash: `0x${string}` } }>(
        `${syncBase}/submit`, { method: "POST", body: { deliverableContent: content, deliverableUri: uri || undefined } },
      );
      setOpen(null);
      // 2) the freelancer's wallet anchors that exact hash on-chain
      return {
        write: write("submitMilestoneWork", [pid, idx, stored.anchor.deliverableHash, stored.submission.deliverableUri ?? ""]),
        syncPath: `${syncBase}/submit`,
        syncBody: { submissionId: stored.submission.id },
      };
    });
  }

  function resolveDispute() {
    try {
      const r = toUsdcBaseUnits(releaseAmt || "0");
      const f = toUsdcBaseUnits(refundAmt || "0");
      if (r + f !== amountUnits) {
        setLocalError(`Release + refund must equal the milestone amount (${formatUsdc(m.amountUsdc)} USDC)`);
        return;
      }
      setLocalError(null);
      void send("Resolve dispute on Arc", "resolveDispute", [pid, idx, r, f], "resolve");
      setOpen(null);
    } catch {
      setLocalError("Enter valid USDC amounts (up to 6 decimals)");
    }
  }

  const toggle = (k: NonNullable<typeof open>) => { setLocalError(null); setOpen(open === k ? null : k); };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">Milestone {m.milestoneIndex} · {m.title.replace(/^Milestone \d+:\s*/, "")}</h3>
          <p className="mt-0.5 text-sm text-ink-2">{formatUsdc(m.amountUsdc)} USDC</p>
        </div>
        <StateBadge state={m.state} />
      </div>
      <p className="mt-3 text-sm text-ink-2" data-testid="status-note">{statusNote(m.state, view)}</p>
      <div className="mt-4"><Stepper m={m} /></div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
        {m.addTxHash && <TxLink hash={m.addTxHash} label="Registered" />}
        {m.fundingTxHash && <TxLink hash={m.fundingTxHash} label="Funded" />}
        {m.releaseTxHash && <TxLink hash={m.releaseTxHash} label="Released" />}
      </div>

      {latest && (
        <details className="mt-4 rounded-lg border border-rule bg-surface-2 p-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-ink-2">
            <ChevronDown className="h-4 w-4" /> Deliverable v{latest.version}
            {latest.anchorTxHash
              ? <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[11px] text-emerald-300">hash anchored on Arc</span>
              : <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">stored, not yet anchored on Arc</span>}
            <span className="ml-auto mono text-xs text-ink-3" title={latest.deliverableHash}>sha256 {latest.deliverableHash.slice(0, 12)}…</span>
          </summary>
          {latest.deliverableUri && <p className="mt-2 text-xs text-ink-3">URI: <span className="mono">{latest.deliverableUri}</span></p>}
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white p-3 text-xs text-ink-2">{latest.content ?? latest.notes ?? "(no text stored)"}</pre>
        </details>
      )}
      {latestEval && <div className="mt-4"><EvaluationPanel evaluation={latestEval} /></div>}

      {shown.length > 0 && (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            {shown.map((a) => {
              const dis = disabled(a.id);
              switch (a.id) {
                case "register_milestone":
                  return <button key={a.id} disabled={dis} title={a.reason} className={primary}
                    onClick={() => void tx.run(`Register milestone ${m.milestoneIndex} on Arc`, async () => ({
                      write: write("addMilestone", [pid, criteriaHashToBytes32(m.criteriaHash ?? ""), amountUnits]),
                      syncPath: `${syncBase}/register`,
                    }))}>Register on Arc</button>;
                case "approve_usdc":
                  return <button key={a.id} disabled={dis} title={a.reason} className={primary}
                    onClick={() => void tx.run(`Approve ${formatUsdc(m.amountUsdc)} USDC for escrow`, async () => ({
                      write: { address: ARC_TESTNET_CONFIG.usdcContract as `0x${string}`, abi: ERC20_ABI as readonly unknown[], functionName: "approve", args: [escrow, amountUnits] },
                    }))}><Wallet className="h-4 w-4" /> Approve {formatUsdc(m.amountUsdc)} USDC</button>;
                case "fund":
                  return <button key={a.id} disabled={dis} title={a.reason} className={primary}
                    onClick={() => void send("Fund milestone escrow", "fundMilestone", [pid, idx], "fund")}><Wallet className="h-4 w-4" /> Fund escrow</button>;
                case "evaluate":
                  return <button key={a.id} disabled={dis || evaluating} title={a.reason} className={subtle} onClick={() => toggle("evaluate")}><Bot className="h-4 w-4" /> AI evaluation (advisory)</button>;
                case "request_revision":
                  return <button key={a.id} disabled={dis} title={a.reason} className={subtle} onClick={() => toggle("revision")}><RotateCcw className="h-4 w-4" /> Request revision</button>;
                case "release":
                  return <button key={a.id} disabled={dis} title={a.reason} className={primary}
                    onClick={() => void send("Release funds to freelancer", "releaseMilestone", [pid, idx], "release")}><Unlock className="h-4 w-4" /> Release funds</button>;
                case "submit":
                  return <button key={a.id} disabled={dis} title={a.reason} className={primary} onClick={() => toggle("submit")}><Send className="h-4 w-4" /> Submit deliverable</button>;
                case "dispute":
                  return <button key={a.id} disabled={dis} title={a.reason} className={danger} onClick={() => toggle("dispute")}><Gavel className="h-4 w-4" /> Open dispute</button>;
                case "refund":
                  return <button key={a.id} disabled={dis} title={a.reason} className={subtle}
                    onClick={() => void send("Refund the client", "refundMilestone", [pid, idx], "refund")}><Undo2 className="h-4 w-4" /> Refund client</button>;
                case "resolve":
                  return <button key={a.id} disabled={dis} title={a.reason} className={primary} onClick={() => toggle("resolve")}><Gavel className="h-4 w-4" /> Resolve dispute</button>;
                default:
                  return null;
              }
            })}
          </div>
          {shown.some((a) => !a.available && a.reason) && (
            <ul className="space-y-0.5 text-xs text-ink-3">
              {shown.filter((a) => !a.available && a.reason).map((a) => <li key={a.id}>{a.id.replace(/_/g, " ")}: {a.reason}</li>)}
            </ul>
          )}

          {open === "submit" && (
            <div className="space-y-2 rounded-lg border border-rule p-3">
              <label className="block text-xs text-ink-2">Deliverable (text or code). Its SHA-256 is anchored on Arc so it cannot be swapped later.</label>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} maxLength={MAX_DELIVERABLE_CHARS} className={`${input} mono`} placeholder="Paste the work to be reviewed…" />
              <p className="text-right text-xs text-ink-3">{content.length.toLocaleString("en-US")} / {MAX_DELIVERABLE_CHARS.toLocaleString("en-US")} characters. The AI reads all of it; for larger work, submit a summary and link the full material below.</p>
              <input value={uri} onChange={(e) => setUri(e.target.value)} className={input} placeholder="Optional URI (e.g. a repository or IPFS link)" />
              <button disabled={!content.trim() || tx.busy} onClick={submitWork} className={primary}><Send className="h-4 w-4" /> Sign and submit on Arc</button>
            </div>
          )}
          {(open === "revision" || open === "dispute") && (
            <div className="space-y-2 rounded-lg border border-rule p-3">
              <label className="block text-xs text-ink-2">{open === "revision" ? "What needs to change?" : "Why are you opening a dispute?"} (recorded on-chain)</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className={input} />
              <button disabled={!reason.trim() || tx.busy} className={open === "dispute" ? danger : primary}
                onClick={() => { void send(open === "revision" ? "Request revision" : "Open dispute", open === "revision" ? "requestRevision" : "disputeMilestone", [pid, idx, reason.trim()], open === "revision" ? "revision" : "dispute"); setOpen(null); setReason(""); }}>
                Sign and send
              </button>
            </div>
          )}
          {open === "evaluate" && (
            <div className="space-y-2 rounded-lg border border-rule p-3 text-sm">
              <label className="flex items-start gap-2 text-ink-2">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
                I consent to sending this deliverable's text to the 0G AI provider for an advisory evaluation.
              </label>
              <p className="text-xs text-ink-3">The result is advisory. It cannot release, refund or move any funds; only your wallet can.</p>
              {!zeroGReady && !systemStatus.isLoading && (
                <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
                  AI evaluation is unavailable on this server: {systemStatus.data?.zeroG.detail ?? "its status could not be checked."} No evaluation will be run.
                </p>
              )}
              <button disabled={!consent || evaluating || !zeroGReady} onClick={runEvaluation} className={primary}>
                {evaluating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />} Run evaluation
              </button>
            </div>
          )}
          {open === "resolve" && (
            <div className="space-y-2 rounded-lg border border-rule p-3">
              <p className="text-xs text-ink-2">Split {formatUsdc(m.amountUsdc)} USDC between the parties. The amounts must add up exactly.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={releaseAmt} onChange={(e) => setReleaseAmt(e.target.value)} inputMode="decimal" className={input} placeholder="To freelancer (USDC)" />
                <input value={refundAmt} onChange={(e) => setRefundAmt(e.target.value)} inputMode="decimal" className={input} placeholder="Back to client (USDC)" />
              </div>
              <button disabled={tx.busy} onClick={resolveDispute} className={primary}>Sign resolution</button>
            </div>
          )}
          {localError && <p className="text-sm text-rose-300">{localError}</p>}
        </div>
      )}
    </Card>
  );
}
