"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, LogOut, ShieldCheck, Wallet } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { useArcWallet } from "@/hooks/useArcWallet";
import { shortAddress } from "@/lib/format";

const btn =
  "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

/** Connect MetaMask, show network status, switch to Arc Testnet, and sign in with the wallet. */
export function WalletButton() {
  const w = useArcWallet();
  const auth = useAuth();

  if (!w.mounted) {
    return <div className="h-9 w-40 animate-pulse rounded-lg bg-surface-2" aria-hidden />;
  }

  if (!w.isConnected) {
    if (!w.hasProvider) {
      return (
        <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className={`${btn} border border-rule text-ink-2 hover:bg-surface-2`}>
          <ExternalLink className="h-4 w-4" /> Install MetaMask
        </a>
      );
    }
    return (
      <div className="flex flex-col items-end gap-1">
        <button onClick={w.connectMetaMask} disabled={w.connecting} className={`${btn} bg-arc-blue text-white hover:bg-blue-500`}>
          {w.connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
          Connect MetaMask
        </button>
        {w.error && <span className="max-w-[18rem] truncate text-xs text-rose-300" title={w.error}>{w.error.split("\n")[0]}</span>}
      </div>
    );
  }

  const signedIn = auth.status === "authenticated" && !auth.walletMismatch;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {w.onArc ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-ok">
          <CheckCircle2 className="h-3.5 w-3.5" /> Arc Testnet
        </span>
      ) : (
        <button onClick={w.switchToArc} disabled={w.switching} className={`${btn} border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`}>
          {w.switching ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
          Wrong network · Switch to Arc Testnet
        </button>
      )}

      <span className="rounded-lg border border-rule bg-surface-2 px-2.5 py-1.5 mono text-xs text-ink-2" title={w.address}>
        {shortAddress(w.address)}
      </span>

      {signedIn ? (
        <div className="flex items-center gap-2">
          <button onClick={w.connectMetaMask} disabled={w.connecting} className={`${btn} border border-rule text-ink-2 hover:bg-surface-2`} title="Switch to another MetaMask account">
            <Wallet className="h-4 w-4" /> Switch wallet
          </button>
          <button onClick={auth.signOut} disabled={auth.busy} className={`${btn} border border-rule text-ink-2 hover:bg-surface-2`} title="End your TRUSTORA session">
            <ShieldCheck className="h-4 w-4 text-emerald-400" /> Signed in
          </button>
        </div>
      ) : (
        <Link href="/register" className={`${btn} bg-arc-blue text-white hover:bg-blue-500`}>
          <ShieldCheck className="h-4 w-4" /> {auth.walletMismatch ? "Choose role to sign in" : "Get started"}
        </Link>
      )}

      <button onClick={w.disconnect} className={`${btn} px-2 text-ink-3 hover:text-ink`} title="Disconnect wallet" aria-label="Disconnect wallet">
        <LogOut className="h-4 w-4" />
      </button>
      {auth.error && <p className="basis-full text-right text-xs text-risk">{auth.error}</p>}
      {auth.walletMismatch && (
        <p className="basis-full text-right text-xs text-amber-300">
          Your session belongs to {shortAddress(auth.sessionAddress)}. Sign in again to use this wallet.
        </p>
      )}
    </div>
  );
}
