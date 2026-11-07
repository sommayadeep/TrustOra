"use client";

import Link from "next/link";
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

/** Catches unexpected render errors so a bug shows a recovery path instead of a blank page. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="surface mx-auto max-w-lg rounded-xl p-8 text-center">
      <TriangleAlert className="mx-auto mb-3 h-8 w-8 text-amber-300" />
      <h1 className="text-lg font-semibold text-white">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-3">Nothing was sent to the blockchain by this error. You can try again or go back to your dashboard.</p>
      <div className="mt-5 flex justify-center gap-3">
        <button onClick={reset} className="rounded-lg bg-arc-blue px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">Try again</button>
        <Link href="/dashboard" className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5">Dashboard</Link>
      </div>
    </div>
  );
}
