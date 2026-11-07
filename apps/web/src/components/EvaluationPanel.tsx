import { Bot, Info } from "lucide-react";
import type { ProjectDetail } from "@/hooks/useProject";

type Evaluation = ProjectDetail["milestones"][number]["submissions"][number]["evaluations"][number];

const VERDICT_TONE: Record<string, string> = {
  PASS: "bg-emerald-50 text-ok border-emerald-200",
  PARTIAL: "bg-amber-50 text-amber-800 border-amber-200",
  FAIL: "bg-rose-50 text-risk border-risk/30",
  UNABLE_TO_ASSESS: "bg-surface-2 text-ink-2 border-rule",
};

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Advisory AI report. It is always labelled advisory, and an absent model is stated plainly, never implied. */
export function EvaluationPanel({ evaluation }: { evaluation: Evaluation }) {
  const results = parse<Array<{ id: string; text: string; verdict: string; evidence: string }>>(evaluation.criteriaResultsJson, []);
  const limitations = parse<string[]>(evaluation.findingsJson, []);
  const modelRan = !!evaluation.inferenceRequestId;
  return (
    <div className="rounded-xl border border-rule bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Bot className="h-4 w-4 text-zerog-cyan" />
        <span className="font-medium text-ink">AI evaluation</span>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${VERDICT_TONE[evaluation.overallVerdict] ?? VERDICT_TONE.UNABLE_TO_ASSESS}`}>
          {evaluation.overallVerdict.replace(/_/g, " ")}
        </span>
        <span className="rounded-full border border-rule px-2 py-0.5 text-[11px] text-ink-2">
          {evaluation.inferenceRequestId ? "COMPLETED" : "UNABLE TO ASSESS"}
        </span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">Advisory only · cannot release funds</span>
      </div>

      {!modelRan && (
        <p className="mb-3 flex items-start gap-2 text-sm text-ink-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" /> No AI model assessed this deliverable, so no criterion is marked as passing.
        </p>
      )}

      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.id} className="text-sm">
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 shrink-0 rounded border px-1.5 text-[10px] font-semibold ${VERDICT_TONE[r.verdict] ?? VERDICT_TONE.UNABLE_TO_ASSESS}`}>{r.verdict.replace(/_/g, " ")}</span>
                <span className="text-ink-2">{r.text}</span>
              </div>
              {r.evidence && <p className="ml-1 mt-1 border-l border-rule pl-3 text-xs text-ink-3">{r.evidence}</p>}
            </li>
          ))}
        </ul>
      )}

      {limitations.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-2">
          {limitations.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-ink-3 sm:grid-cols-2">
        <div><dt className="inline">Report hash: </dt><dd className="inline mono" title={evaluation.reportHash}>{evaluation.reportHash.slice(0, 16)}…</dd></div>
        {modelRan && (
          <>
            <div><dt className="inline">0G request ID: </dt><dd className="inline mono">{evaluation.inferenceRequestId}</dd></div>
            <div><dt className="inline">Provider: </dt><dd className="inline mono">{evaluation.providerAddress ?? "router-selected"}</dd></div>
            <div><dt className="inline">Model: </dt><dd className="inline">{evaluation.modelId ?? "not reported"}</dd></div>
            <div><dt className="inline">TEE: </dt><dd className="inline">{evaluation.teeVerified === null ? "not reported" : evaluation.teeVerified ? "reported verified by router (not independently checked)" : "reported not verified"}</dd></div>
          </>
        )}
        <div><dt className="inline">Evaluated: </dt><dd className="inline">{new Date(evaluation.createdAt).toLocaleString()}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-ink-3">Manual client review is required. Only the client can authorize escrow release.</p>
    </div>
  );
}
