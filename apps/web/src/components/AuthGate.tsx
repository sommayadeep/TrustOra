"use client";

import { ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { useArcWallet } from "@/hooks/useArcWallet";
import { Button, PageSkeleton } from "./bits";

/** A composed gate panel rather than a centred box: icon, statement, action, reassurance. */
function Gate({
  icon: Icon,
  title,
  body,
  action,
  note,
  error,
}: {
  icon: typeof Wallet;
  title: string;
  body: string;
  action: ReactNode;
  note: string;
  error?: string | null;
}) {
  return (
    <div className="anim-rise grid min-h-[46vh] place-items-center py-10">
      <div className="glass glass-sheen w-full max-w-xl rounded-md p-8 sm:p-10">
        <span className="neu inline-flex h-11 w-11 items-center justify-center rounded-sm text-royal">
          <Icon className="h-5 w-5" />
        </span>
        <h1 className="display display-md mt-6 text-ink">{title}</h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-ink-2">{body}</p>
        <div className="mt-7">{action}</div>
        <p className="rule-t mt-7 pt-4 text-xs leading-5 text-ink-3">{note}</p>
        {error && (
          <p role="alert" className="mt-3 text-xs text-risk">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Renders children only for a connected wallet with a valid server session; otherwise says exactly what is missing. */
export function AuthGate({ children }: { children: ReactNode }) {
  const w = useArcWallet();
  const auth = useAuth();

  if (!w.mounted || auth.status === "loading") {
    return <PageSkeleton rows={2} />;
  }
  if (!w.isConnected) {
    return (
      <Gate
        icon={Wallet}
        title="Connect your wallet"
        body="TRUSTORA uses your wallet to sign in and to authorise every escrow transaction. Nothing is signed without you."
        action={
          <Button onClick={w.connectMetaMask} disabled={!w.hasProvider}>
            {w.hasProvider ? "Connect MetaMask" : "MetaMask not detected"}
          </Button>
        }
        note="Connecting reveals only your public address. TRUSTORA never sees your private key."
      />
    );
  }
  if (auth.status !== "authenticated" || auth.walletMismatch) {
    return (
      <Gate
        icon={ShieldCheck}
        title={auth.walletMismatch ? "Sign in with the connected wallet" : "Sign in to continue"}
        body="Sign a message to prove you own this wallet. It costs no gas and it cannot move funds."
        action={
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-sm bg-royal px-4 py-2.5 text-sm font-medium text-white shadow-soft transition-all duration-150 hover:bg-royal-deep active:translate-y-px"
          >
            <ShieldCheck className="h-4 w-4" /> Choose a role to continue
          </Link>
        }
        note="The signature proves ownership of the address. It is not a transaction."
        error={auth.error}
      />
    );
  }
  return <>{children}</>;
}
