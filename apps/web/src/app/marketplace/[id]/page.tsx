"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AuthGate } from "@/components/AuthGate";
import { Card, Empty, ErrorState, PageSkeleton } from "@/components/bits";
import { api } from "@/lib/api";
import { errorMessage, shortAddress } from "@/lib/format";

type Opportunity = {
  id: string; title: string; description: string; budgetUsdc: number; clientAddress: string;
  requiredSkills: string | null; expectedDurationDays: number | null; publishedAt: string;
  milestoneCount: number; applicationStatus: string | null;
};

function Detail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["marketplace-project", id], queryFn: () => api<{ project: Opportunity }>(`/api/marketplace/${id}`) });
  if (q.isLoading) return <PageSkeleton rows={3} />;
  if (q.error) return <ErrorState title="Could not load opportunity" message={q.error.message} onRetry={() => void q.refetch()} />;
  const project = q.data!.project;
  const apply = async () => {
    setBusy(true); setError(null);
    try { await api(`/api/marketplace/${project.id}/apply`, { method: "POST", body: {} }); await queryClient.invalidateQueries({ queryKey: ["marketplace-project", id] }); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <div className="space-y-5"><Link href="/marketplace" className="text-sm font-medium text-royal">← Back to marketplace</Link><Card className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="mono text-xs text-ink-3">{project.id}</p><h1 className="mt-1 text-3xl font-semibold text-ink">{project.title}</h1></div><p className="text-xl font-semibold text-ink">{project.budgetUsdc.toLocaleString()} USDC</p></div><p className="whitespace-pre-wrap text-ink-2">{project.description}</p><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-ink-3">Client wallet</dt><dd className="mono">{shortAddress(project.clientAddress)}</dd></div><div><dt className="text-ink-3">Published</dt><dd>{new Date(project.publishedAt).toLocaleDateString()}</dd></div><div><dt className="text-ink-3">Skills</dt><dd>{project.requiredSkills || "Not specified"}</dd></div><div><dt className="text-ink-3">Milestones / duration</dt><dd>{project.milestoneCount}{project.expectedDurationDays ? ` / ${project.expectedDurationDays} days` : ""}</dd></div></dl>{project.applicationStatus ? <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm font-medium">Application {project.applicationStatus.toLowerCase()}</p> : <button type="button" disabled={busy} onClick={() => void apply()} className="rounded-lg bg-royal px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Applying…" : "Apply to project"}</button>}{error && <p role="alert" className="text-sm text-risk">{error}</p>}</Card></div>;
}

export default function MarketplaceDetailPage() { return <AuthGate><Detail /></AuthGate>; }
