"use client";

import { CheckCircle2, Loader2, UserRound, Wrench } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useArcWallet } from "@/hooks/useArcWallet";
import type { AccountRole } from "@/lib/roles";

const cards: Array<{ role: AccountRole; title: string; icon: typeof UserRound; description: string; items: string[] }> = [
  {
    role: "CLIENT",
    title: "Client",
    icon: UserRound,
    description: "Hire freelancers and secure every promise.",
    items: ["Create projects", "Set milestones", "Fund escrow", "Review deliverables", "Release or dispute payments"],
  },
  {
    role: "FREELANCER",
    title: "Freelancer",
    icon: Wrench,
    description: "Do great work and build verifiable reputation.",
    items: ["Receive project invitations", "Accept agreements", "Submit deliverables", "Track milestone payments", "Build reputation"],
  },
];

export default function RegisterPage() {
  const wallet = useArcWallet();
  const auth = useAuth();
  const [selected, setSelected] = useState<AccountRole | null>(null);

  async function continueRegistration() {
    if (!selected) return;
    await auth.signIn(selected);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="text-center">
        <p className="text-sm font-medium text-royal">TRUSTORA registration</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Choose your workspace</h1>
        <p className="mx-auto mt-3 max-w-2xl text-ink-2">Choose one role before connecting your wallet. One wallet can have exactly one TRUSTORA role.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {cards.map(({ role, title, icon: Icon, description, items }) => {
          const active = selected === role;
          return (
            <button key={role} type="button" onClick={() => setSelected(role)} aria-pressed={active} className={`rounded-2xl border p-6 text-left transition ${active ? "border-royal bg-[#F4F7FF] ring-2 ring-[#3867F6]/20" : "border-rule bg-white hover:border-[#9DB4FF]"}`}>
              <div className="flex items-start justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-royal-wash text-royal"><Icon className="h-5 w-5" /></span>{active && <CheckCircle2 className="h-5 w-5 text-royal" />}</div>
              <h2 className="mt-5 text-xl font-semibold text-ink">{title}</h2>
              <p className="mt-1 text-sm text-ink-2">{description}</p>
              <ul className="mt-5 space-y-2 text-sm text-ink-2">{items.map((item) => <li key={item} className="flex gap-2"><span className="text-royal">✓</span>{item}</li>)}</ul>
            </button>
          );
        })}
      </div>
      <div className="flex flex-col items-center gap-3">
        {!wallet.isConnected ? (
          <button type="button" onClick={wallet.connectMetaMask} disabled={!selected || wallet.connecting || !wallet.hasProvider} className="inline-flex items-center gap-2 rounded-lg bg-royal px-5 py-3 font-semibold text-white disabled:opacity-50">
            {wallet.connecting && <Loader2 className="h-4 w-4 animate-spin" />} {wallet.hasProvider ? "Connect MetaMask" : "Install MetaMask"}
          </button>
        ) : !wallet.onArc ? (
          <button type="button" onClick={wallet.switchToArc} disabled={wallet.switching} className="rounded-lg bg-amber-500 px-5 py-3 font-semibold text-white">Switch to Arc Testnet</button>
        ) : (
          <button type="button" onClick={() => void continueRegistration()} disabled={!selected || auth.busy} className="inline-flex items-center gap-2 rounded-lg bg-royal px-5 py-3 font-semibold text-white disabled:opacity-50">
            {auth.busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in as {selected === "CLIENT" ? "Client" : "Freelancer"}
          </button>
        )}
        <p className="text-center text-xs text-ink-3">Your signature proves wallet ownership only. It cannot move funds.</p>
        {auth.error && <p role="alert" className="text-sm text-risk">{auth.error}</p>}
      </div>
    </div>
  );
}
