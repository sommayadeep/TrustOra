"use client";

import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { Card, Empty, ErrorState, PageHeader, PageSkeleton } from "@/components/bits";
import { StatusPanel } from "@/components/StatusPanel";
import { useProjects, type ProjectSummary } from "@/hooks/useProjects";
import { useAuth } from "@/components/AuthProvider";
import { formatUsdc } from "@/lib/format";
import { nextStepFor } from "@/lib/workflow";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const IN_ESCROW = ["FUNDED", "SUBMITTED", "REVISION_REQUESTED", "DISPUTED"];

function Dashboard() {
  const q = useProjects();
  const auth = useAuth();
  if (q.isLoading) return <PageSkeleton rows={4} />;
  if (q.error) return <ErrorState title="Could not load your projects" message={q.error.message} onRetry={() => void q.refetch()} />;
  const projects = q.data ?? [];
  if (auth.accountRole === "FREELANCER") return <FreelancerDashboard projects={projects} />;
  const clientProjects = projects.filter((p) => p.roles.includes("client"));

  const inEscrow = projects.reduce((sum, p) => (p.roles.includes("client") ? sum + p.milestones.filter((m) => IN_ESCROW.includes(m.state)).reduce((s, m) => s + m.amountUsdc, 0) : sum), 0);
  const released = projects.reduce((sum, p) => sum + p.milestones.filter((m) => m.state === "RELEASED").reduce((s, m) => s + m.amountUsdc, 0), 0);
  const attention = projects
    .map((p) => ({ p, step: nextStepFor({ registerTxHash: p.registerTxHash, agreement: p.agreementVersions[0] ?? null, milestones: p.milestones }, p.roles) }))
    .filter((x) => x.step);

  const stats = [
    { label: "Client projects", value: String(clientProjects.length) },
    { label: "In escrow (as client)", value: `${formatUsdc(inEscrow)} USDC` },
    { label: "Released", value: `${formatUsdc(released)} USDC` },
    { label: "Needs your action", value: String(attention.length) },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace overview"
        title={<>Your financial<br/>operations.</>}
        aside={auth.accountRole === "CLIENT" ? (
          <Link href="/projects/new" className="inline-flex items-center gap-2 rounded-sm bg-ink px-4 py-2.5 text-sm font-medium text-ink-inverse shadow-soft transition-all duration-150 hover:bg-[#0f1829] active:translate-y-px"><Plus className="h-4 w-4" /> New contract</Link>
        ) : undefined}
      />

      <nav aria-label="Dashboard sections" className="flex flex-wrap gap-2 border-b border-rule pb-4">
        {auth.accountRole === "CLIENT" && <a href="#client-projects" className="rounded-lg border border-rule bg-white px-3 py-2 text-sm font-medium text-ink-2 hover:border-royal">My Client Projects <span className="ml-1 text-ink-3">{clientProjects.length}</span></a>}
      </nav>

      <div className="grid gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface px-5 py-6">
            <p className="eyebrow">{s.label}</p>
            <p className="display mt-2.5 text-[1.75rem] font-semibold tracking-[-0.03em] tabular-nums text-ink">{s.value}</p>
          </div>
        ))}
      </div>

      <StatusPanel />

      {projects.some((p) => p.status === "DRAFT") && <Card><h2 className="font-semibold text-ink">Draft projects</h2><p className="mt-1 text-sm text-ink-3">Publish a draft when you are ready for eligible freelancers to discover it.</p><div className="mt-3 space-y-2">{projects.filter((p) => p.status === "DRAFT").map((p) => <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule p-3"><span className="text-sm font-medium">{p.title}</span><PublishButton projectId={p.id} /></div>)}</div></Card>}

      {auth.accountRole === "CLIENT" && <section id="client-projects" className="scroll-mt-24 space-y-3">
        <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-royal">Client workspace</p><h2 className="display mt-1 text-xl font-semibold tracking-[-0.02em] text-ink">My Client Projects</h2></div><Link href="/projects/new" className="text-sm font-medium text-royal">Create project</Link></div>
        {clientProjects.length === 0 ? <Empty title="No client projects">Projects you create as the client appear here.</Empty> : <div className="grid gap-3 lg:grid-cols-2">{clientProjects.map((p)=><Link key={p.id} href={`/projects/${p.id}`} className="surface surface-hover rounded-xl p-5"><div className="flex items-start justify-between gap-3"><div><p className="mono text-xs text-ink-3">{p.id}</p><h3 className="mt-1 font-semibold text-ink">{p.title}</h3><p className="mt-1 text-xs text-ink-3">Freelancer {p.freelancerAddress ? p.freelancerAddress.slice(0,6)+"…"+p.freelancerAddress.slice(-4) : "Not assigned"}</p></div><span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-2">{p.status.replaceAll("_"," ")}</span></div><div className="mt-4 flex items-center justify-between border-t border-rule pt-3 text-sm"><span className="text-ink-3">{p.milestones.filter(m=>m.state==="RELEASED").length}/{p.milestones.length} milestones released</span><span className="font-semibold text-ink">{formatUsdc(p.budgetUsdc)} USDC</span></div></Link>)}</div>}
      </section>}

      {auth.accountRole === "CLIENT" && <ClientApplications />}

      <section>
        <h2 className="display mb-4 text-xl font-semibold tracking-[-0.02em] text-ink">Needs your action</h2>
        {attention.length === 0 ? (
          <Empty title="You're all caught up">Nothing is waiting on your wallet right now.</Empty>
        ) : (
          <div className="space-y-3">
            {attention.map(({ p, step }) => (
              <Link key={p.id} href={`/projects/${p.id}/${step!.tab}`} className="surface surface-hover flex flex-wrap items-center justify-between gap-3 rounded-xl p-4">
                <div>
                  <p className="font-medium text-ink">{p.title}</p>
                  <p className="mt-0.5 text-sm text-ink-3">{step!.text}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-royal" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display text-xl font-semibold tracking-[-0.02em] text-ink">Recent projects</h2>
          <Link href="/projects" className="text-sm font-medium text-royal hover:underline">View all</Link>
        </div>
        {projects.length === 0 ? (
          <Empty title="No projects yet">Create one to lock your first milestone in escrow.<div className="mt-4"><Link href="/projects/new" className="rounded-lg bg-royal px-4 py-2 text-sm font-medium text-white hover:bg-royal-deep">Create a project</Link></div></Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.slice(0, 4).map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="surface surface-hover rounded-xl p-4">
                <p className="font-medium text-ink">{p.title}</p>
                <p className="mt-1 text-xs text-ink-3">{p.status.replace("_", " ")} · {formatUsdc(p.budgetUsdc)} USDC · {p.roles.join(", ")}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PublishButton({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <span className="flex items-center gap-2">{error && <span className="text-xs text-risk">{error}</span>}<button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await api(`/api/projects/${projectId}/publish`, { method: "POST", body: {} }); await queryClient.invalidateQueries({ queryKey: ["projects"] }); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }} className="rounded-lg bg-royal px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Publishing…" : "Publish"}</button></span>;
}

function FreelancerDashboard({ projects }: { projects: Array<ProjectSummary & { roles: string[] }> }) {
  const applications = useQuery({
    queryKey: ["my-applications"],
    queryFn: () => api<{ applications: Array<{ id: string; status: string; createdAt: string; project: { id: string; title: string; status: string; budgetUsdc: number } }> }>("/api/applications/mine"),
  });
  const invitations = projects.filter((p) => p.roles.includes("freelancer") && !p.agreementVersions[0]?.freelancerAccepted);
  const active = projects.filter((p) => p.roles.includes("freelancer") && p.agreementVersions[0]?.freelancerAccepted);
  const submitted = active.reduce((n, p) => n + p.milestones.filter((m) => m.state === "SUBMITTED").length, 0);
  const paid = active.reduce((n, p) => n + p.milestones.filter((m) => m.state === "RELEASED").reduce((s, m) => s + m.amountUsdc, 0), 0);
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Freelancer workspace" title={<>Your work,<br/>on the record.</>} lede="Find opportunities, manage invitations, and submit deliverables that are anchored on-chain." />
      <div className="grid gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Invitations", value: String(invitations.length) },
          { label: "Active contracts", value: String(active.length) },
          { label: "Submitted for review", value: String(submitted) },
          { label: "Verified paid", value: `${formatUsdc(paid)} USDC` },
        ].map((f) => (
          <div key={f.label} className="bg-surface px-5 py-6">
            <p className="eyebrow">{f.label}</p>
            <p className="display mt-2.5 text-[1.75rem] font-semibold tracking-[-0.03em] tabular-nums text-ink">{f.value}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3"><Link href="/marketplace" className="rounded-lg bg-royal px-4 py-2.5 text-sm font-semibold text-white">Explore Marketplace</Link><Link href="/projects" className="rounded-lg border border-rule px-4 py-2.5 text-sm font-semibold text-ink-2">My Contracts</Link></div>
      <section className="space-y-3"><h2 className="display text-xl font-semibold tracking-[-0.02em] text-ink">My applications</h2>{applications.isLoading ? <PageSkeleton rows={2} /> : applications.error ? <ErrorState title="Could not load applications" message={applications.error.message} onRetry={() => void applications.refetch()} /> : applications.data?.applications.length ? <div className="grid gap-3 lg:grid-cols-2">{applications.data.applications.map((application) => <Card key={application.id}><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-ink">{application.project.title}</p><p className="mt-1 text-xs text-ink-3">{new Date(application.createdAt).toLocaleDateString()} · {formatUsdc(application.project.budgetUsdc)} USDC</p></div><span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium">{application.status}</span></div></Card>)}</div> : <Empty title="No applications yet">Explore the marketplace to find published opportunities.</Empty>}</section>
      <section className="space-y-3"><h2 className="display text-xl font-semibold tracking-[-0.02em] text-ink">Invitations and contracts</h2>{projects.length === 0 ? <Empty title="No invitations yet">Published opportunities and direct client invitations will appear here.</Empty> : <div className="grid gap-3 lg:grid-cols-2">{projects.map((p) => <Link key={p.id} href={`/projects/${p.id}`} className="surface surface-hover rounded-xl p-5"><p className="mono text-xs text-ink-3">{p.id}</p><h3 className="mt-1 font-semibold text-ink">{p.title}</h3><p className="mt-2 text-sm text-ink-3">{p.agreementVersions[0]?.freelancerAccepted ? "Active contract" : "Invitation · agreement signature needed"}</p><p className="mt-3 text-sm font-semibold">{formatUsdc(p.budgetUsdc)} USDC · {p.milestones.length} milestones</p></Link>)}</div>}</section>
    </div>
  );
}

type ReceivedApplication = { id: string; applicantAddress: string; message: string | null; status: string; createdAt: string; project: { id: string; title: string; status: string } };

function ClientApplications() {
  const queryClient = useQueryClient();
  const applications = useQuery({ queryKey: ["received-applications"], queryFn: () => api<{ applications: ReceivedApplication[] }>("/api/applications/received") });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(application: ReceivedApplication, action: "approve" | "reject") {
    setBusy(application.id); setError(null);
    try {
      await api(`/api/projects/${application.project.id}/applications/${application.id}`, { method: action === "approve" ? "POST" : "DELETE", body: {} });
      await queryClient.invalidateQueries({ queryKey: ["received-applications"] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }
  return <section id="applications" className="scroll-mt-24 space-y-3"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-royal">Client workspace</p><h2 className="display mt-1 text-xl font-semibold tracking-[-0.02em] text-ink">Applications received</h2></div>{applications.isLoading ? <PageSkeleton rows={2} /> : applications.error ? <ErrorState title="Could not load applications" message={applications.error.message} onRetry={() => void applications.refetch()} /> : applications.data?.applications.length ? <div className="space-y-3">{applications.data.applications.map((application) => <Card key={application.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-ink">{application.project.title}</p><p className="mt-1 mono text-xs text-ink-3">{application.applicantAddress}</p><p className="mt-1 text-xs text-ink-3">Applied {new Date(application.createdAt).toLocaleDateString()} · {application.status}</p>{application.message && <p className="mt-3 text-sm text-ink-2">{application.message}</p>}</div><div className="flex items-center gap-2">{application.status === "PENDING" ? <><button type="button" disabled={busy === application.id} onClick={() => void decide(application, "approve")} className="rounded-lg bg-royal px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Approve</button><button type="button" disabled={busy === application.id} onClick={() => void decide(application, "reject")} className="rounded-lg border border-risk/30 px-3 py-2 text-xs font-semibold text-risk disabled:opacity-50">Reject</button></> : <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium">{application.status}</span>}</div></div></Card>)}</div> : <Empty title="No applications received">Applications from freelancers will appear here after you publish a project.</Empty>}{error && <p role="alert" className="text-sm text-risk">{error}</p>}</section>;
}

export default function DashboardPage() {
  return <AuthGate><Dashboard /></AuthGate>;
}
