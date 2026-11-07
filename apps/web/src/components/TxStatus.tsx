"use client";

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, X } from "lucide-react";
import type { TxState } from "@/hooks/useEscrowTx";
import { TxLink } from "./bits";

type StepState = "pending" | "active" | "done" | "failed";

function stepStates(s: TxState): StepState[] {
  const n = s.verifies ? 3 : 2;
  const out: StepState[] = Array(n).fill("pending");
  const idx = { signing: 0, confirming: 1, syncing: 2 } as const;
  if (s.phase === "done") return out.map(() => "done");
  if (s.phase === "error") {
    // No hash: the wallet step failed. Hash + resync available: verification failed. Otherwise confirmation failed.
    const failedAt = !s.hash ? 0 : s.canResync ? n - 1 : 1;
    return out.map((_, i) => (i < failedAt ? "done" : i === failedAt ? "failed" : "pending"));
  }
  const at = idx[s.phase as keyof typeof idx] ?? 0;
  return out.map((_, i) => (i < at ? "done" : i === at ? "active" : "pending"));
}

const STEP_LABELS = ["Sign in wallet", "Confirmed on Arc", "Verified by server"];

/**
 * Floating, always-visible progress for wallet-sign -> Arc confirmation -> server verification.
 * "Verified" is shown only when the server actually verified the transaction against the chain.
 */
export function TxStatus({ state, onResync, onDismiss }: { state: TxState; onResync: () => void; onDismiss: () => void }) {
  if (state.phase === "idle") return null;
  const working = ["signing", "confirming", "syncing"].includes(state.phase);
  const steps = stepStates(state);
  const tone =
    state.phase === "error" ? "border-risk/30 bg-rose-50"
    : state.phase === "done" ? "border-emerald-200 bg-emerald-50"
    : "border-sky-200 bg-sky-50";
  const message =
    state.phase === "signing" ? "Confirm the transaction in your wallet. Nothing has been sent yet."
    : state.phase === "confirming" ? "Sent. Waiting for Arc to confirm it."
    : state.phase === "syncing" ? "Confirmed. The server is checking the receipt, event and contract state."
    : state.phase === "done" ? (state.verifies ? "Verified on Arc and recorded." : "Confirmed on Arc.")
    : state.error;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div role="status" aria-live="polite" className={`pointer-events-auto w-full max-w-2xl rounded-xl border p-4 shadow-xl shadow-slate-900/10 ${tone}`}>
        <div className="flex items-start gap-3">
          {working && <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-sky-300" />}
          {state.phase === "done" && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />}
          {state.phase === "error" && <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />}
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">{state.label}</p>
            <p className="mt-0.5 text-sm text-ink-2">{message}</p>
            <ol className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-label="Transaction progress">
              {steps.map((st, i) => (
                <li key={i} className={st === "done" ? "text-ok" : st === "active" ? "text-sky-700" : st === "failed" ? "text-risk" : "text-ink-3"}>
                  {st === "done" ? "✓" : st === "failed" ? "✕" : i + 1}. {STEP_LABELS[state.verifies ? i : i === 0 ? 0 : 1]}
                </li>
              ))}
            </ol>
            {state.hash && <div className="mt-2"><TxLink hash={state.hash} /></div>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {state.canResync && (
              <button onClick={onResync} className="inline-flex items-center gap-1 rounded-md border border-rule-strong px-2.5 py-1 text-xs text-ink-2 hover:bg-white">
                <RefreshCw className="h-3 w-3" /> Sync now
              </button>
            )}
            {!working && <button onClick={onDismiss} aria-label="Dismiss" className="rounded p-1 text-ink-2 hover:bg-white"><X className="h-4 w-4" /></button>}
          </div>
        </div>
      </div>
    </div>
  );
}
