"use client";

import { CheckCircle2, CircleSlash, Loader2, TriangleAlert } from "lucide-react";
import { useSystemStatus } from "@/hooks/useSystemStatus";
import type { Availability } from "@/lib/status";
import { Card } from "./bits";

const LOOK: Record<Availability, { label: string; tone: string; Icon: typeof CheckCircle2 }> = {
  CONFIGURED: { label: "Configured", tone: "text-ok", Icon: CheckCircle2 },
  NOT_CONFIGURED: { label: "Not configured", tone: "text-warn", Icon: TriangleAlert },
  NOT_IMPLEMENTED: { label: "Not available", tone: "text-ink-3", Icon: CircleSlash },
  BLOCKED: { label: "Blocked", tone: "text-risk", Icon: TriangleAlert },
};

/** Shows exactly which integrations are live in this deployment, so nothing looks working that is not. */
export function StatusPanel() {
  const q = useSystemStatus();
  if (q.isLoading) return <Card><Loader2 className="h-4 w-4 animate-spin text-ink-3" /></Card>;
  if (!q.data) return null;
  const rows = [
    { name: "Arc escrow contract", s: q.data.arcEscrow },
    { name: "0G AI evaluation", s: q.data.zeroG },
    { name: "Hedera agent payments", s: q.data.hedera },
  ];
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-3">System status</h2>
      <ul className="space-y-3">
        {rows.map(({ name, s }) => {
          const { label, tone, Icon } = LOOK[s.status];
          return (
            <li key={name} className="flex items-start gap-3 text-sm">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
              <div>
                <p className="text-ink">{name} <span className={`ml-1 text-xs font-medium ${tone}`}>{label}</span></p>
                <p className="text-xs text-ink-2">{s.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
