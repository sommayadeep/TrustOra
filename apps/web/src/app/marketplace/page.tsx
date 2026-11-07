"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AuthGate } from "@/components/AuthGate";
import { Card, Empty, ErrorState, PageSkeleton } from "@/components/bits";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { useAuth } from "@/components/AuthProvider";
import Link from "next/link";

type MarketplaceProject = {
  id: string;
  title: string;
  description: string;
  budgetUsdc: number;
  requiredSkills: string | null;
  expectedDurationDays: number | null;
  milestoneCount: number;
  applicationCount: number;
  applicationStatus: string | null;
};

function MarketplaceList() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [skill, setSkill] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const params = new URLSearchParams();
  if (search.trim()) params.set("q", search.trim());
  if (skill.trim()) params.set("skill", skill.trim());
  if (maxBudget.trim()) params.set("maxBudget", maxBudget.trim());
  const q = useQuery({
    queryKey: ["marketplace", search, skill, maxBudget],
    queryFn: () => api<{ projects: MarketplaceProject[] }>(`/api/marketplace${params.toString() ? `?${params}` : ""}`),
    enabled: auth.accountRole === "FREELANCER",
  });
  if (auth.accountRole !== "FREELANCER") return <Card><h1 className="text-xl font-semibold">Freelancer workspace only</h1><p className="mt-2 text-sm text-ink-2">The marketplace is available to registered freelancer wallets.</p></Card>;
  if (q.isLoading) return <PageSkeleton rows={4} />;
  if (q.error) return <ErrorState title="Could not load marketplace" message={q.error.message} onRetry={() => void q.refetch()} />;
  const projects = q.data?.projects ?? [];
  return (
    <div className="space-y-6">
      <div><p className="text-sm text-ink-3">Freelancer workspace</p><h1 className="mt-1 text-3xl font-semibold text-ink">Marketplace</h1><p className="mt-2 text-sm text-ink-2">Only client-published project summaries are shown here.</p></div>
      <div className="grid gap-3 md:grid-cols-[1fr_180px_150px]">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, description, or skills" className="rounded-lg border border-[#DCE3ED] px-3 py-2.5 text-sm" />
        <input value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="Filter by skill" className="rounded-lg border border-[#DCE3ED] px-3 py-2.5 text-sm" />
        <input value={maxBudget} onChange={(e) => setMaxBudget(e.target.value)} type="number" min="0" placeholder="Max USDC budget" className="rounded-lg border border-[#DCE3ED] px-3 py-2.5 text-sm" />
      </div>
      {projects.length === 0 ? <Empty title="No matching opportunities">Try a different search or check back when clients publish new work.</Empty> : <div className="grid gap-4 lg:grid-cols-2">{projects.map((p) => <MarketplaceCard key={p.id} project={p} onChanged={() => void queryClient.invalidateQueries({ queryKey: ["marketplace"] })} />)}</div>}
    </div>
  );
}

function MarketplaceCard({ project, onChanged }: { project: MarketplaceProject; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applied = project.applicationStatus !== null;
  async function apply() {
    setBusy(true); setError(null);
    try { await api(`/api/marketplace/${project.id}/apply`, { method: "POST", body: {} }); onChanged(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Card className="space-y-3">
    <div className="flex items-start justify-between gap-3"><div><p className="mono text-xs text-ink-3">{project.id}</p><h2 className="mt-1 text-lg font-semibold text-ink">{project.title}</h2></div><span className="font-semibold text-ink">{project.budgetUsdc.toLocaleString()} USDC</span></div>
    <p className="line-clamp-2 text-sm text-ink-2">{project.description}</p>
    <p className="text-xs text-ink-3">{project.milestoneCount} milestones {project.expectedDurationDays ? `· ${project.expectedDurationDays} days` : ""}{project.requiredSkills ? ` · ${project.requiredSkills}` : ""}</p>
    <div className="flex flex-wrap items-center gap-2"><Link href={`/marketplace/${project.id}`} className="rounded-lg border border-rule px-3 py-2 text-sm font-medium text-ink-2">View details</Link>{applied ? <span className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-ink-2">Application {project.applicationStatus?.toLowerCase()}</span> : <button type="button" disabled={busy} onClick={() => void apply()} className="rounded-lg bg-royal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Applying…" : "Apply"}</button>}</div>
    {error && <p role="alert" className="text-sm text-risk">{error}</p>}
  </Card>;
}

export default function MarketplacePage() { return <AuthGate><MarketplaceList /></AuthGate>; }
