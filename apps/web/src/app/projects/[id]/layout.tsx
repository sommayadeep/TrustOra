"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AuthGate } from "@/components/AuthGate";
import { ProjectView } from "@/components/ProjectView";
import { formatUsdc, shortAddress } from "@/lib/format";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "border-rule-strong text-ink-2", AGREED: "border-sky-200 text-sky-700", FUNDED: "border-indigo-200 text-indigo-700",
  IN_PROGRESS: "border-amber-200 text-amber-800", COMPLETED: "border-emerald-200 text-ok", DISPUTED: "border-risk/30 text-risk",
};

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  return (
    <AuthGate>
      <ProjectView id={id}>
        {({ project, viewer }) => {
          const base = `/projects/${project.id}`;
          const tabs = [
            { href: base, label: "Overview", show: true },
            { href: `${base}/client`, label: "Client workspace", show: viewer.roles.includes("client") },
            { href: `${base}/freelancer`, label: "Freelancer workspace", show: viewer.roles.includes("freelancer") },
            { href: `${base}/arbiter`, label: "Arbiter", show: viewer.roles.includes("arbiter") },
            { href: `${base}/proof`, label: "ProofTrack", show: true },
          ].filter((t) => t.show);
          return (
            <div className="space-y-6">
              <div>
                <p className="mono text-xs text-ink-3">{project.id}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-bold text-ink">{project.title}</h1>
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[project.status] ?? STATUS_TONE.DRAFT}`}>{project.status.replace("_", " ")}</span>
                </div>
                <p className="mt-2 text-sm text-ink-2">
                  {formatUsdc(project.budgetUsdc)} USDC · client {shortAddress(project.clientAddress)} · freelancer {shortAddress(project.freelancerAddress)}
                  {project.arbiterAddress && <> · arbiter {shortAddress(project.arbiterAddress)}</>}
                  <span className="ml-2 text-ink-3">You are: {viewer.roles.join(", ")}</span>
                </p>
              </div>
              <nav className="flex gap-1 overflow-x-auto border-b border-rule" aria-label="Project sections">
                {tabs.map((t) => {
                  const active = pathname === t.href;
                  return (
                    <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
                      className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm ${active ? "border-royal text-royal-deep" : "border-transparent text-ink-2 hover:text-ink"}`}>
                      {t.label}
                    </Link>
                  );
                })}
              </nav>
              {children}
            </div>
          );
        }}
      </ProjectView>
    </AuthGate>
  );
}

