import { CheckCircle2, Clock, ExternalLink } from "lucide-react";
import type { ProjectDetail } from "@/hooks/useProject";
import { shortHash } from "@/lib/format";
import { Empty } from "./bits";

const ECO_TONE: Record<string, string> = {
  ARC: "text-arc-light border-arc-blue/40",
  ZERO_G: "text-zerog-cyan border-zerog-cyan/40",
  HEDERA: "text-hedera-purple border-hedera-purple/40",
  TRUSTORA_CORE: "text-ink-2 border-rule-strong",
};
const ECO_LABEL: Record<string, string> = { ARC: "Arc", ZERO_G: "0G", HEDERA: "Hedera", TRUSTORA_CORE: "TRUSTORA" };
const humanize = (s: string) => s.replace(/^0G_/, "0G ").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/**
 * ProofTrack timeline. "Verified" means the backend confirmed it (an Arc event matched on-chain); "Pending" means
 * it is reported by a vendor and not independently verifiable (e.g. a 0G inference request ID, which is not a transaction).
 */
export function ProofTimeline({ events }: { events: ProjectDetail["proofTrackEvents"] }) {
  if (events.length === 0) return <Empty title="No activity yet">Events appear here after the server verifies them.</Empty>;
  return (
    <ol className="relative space-y-4 border-l border-rule pl-6">
      {events.map((e) => {
        const verified = e.verificationStatus === "VERIFIED";
        return (
          <li key={e.id} className="relative">
            <span className={`absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full bg-white ${verified ? "text-ok" : "text-warn"}`}>
              {verified ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            </span>
            <div className="surface rounded-lg p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{humanize(e.eventType)}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${ECO_TONE[e.ecosystem] ?? ECO_TONE.TRUSTORA_CORE}`}>{ECO_LABEL[e.ecosystem] ?? e.ecosystem}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${verified ? "bg-emerald-50 text-ok" : "bg-amber-50 text-amber-800"}`}>
                  {verified ? "Verified" : "Pending / vendor-reported"}
                </span>
                <span className="ml-auto text-xs text-ink-3">#{e.sequence} · {new Date(e.timestamp).toLocaleString()}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <span>{e.referenceType.replace(/_/g, " ").toLowerCase()}:</span>
                {e.explorerUrl ? (
                  <a href={e.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mono text-arc-light hover:underline" title={e.referenceValue}>
                    {shortHash(e.referenceValue)} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="mono text-ink-2" title={e.referenceValue}>{e.referenceValue.length > 24 ? shortHash(e.referenceValue) : e.referenceValue}</span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
