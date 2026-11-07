import { ARC_TESTNET_CONFIG } from "./arc";

export const shortAddress = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
export const shortHash = (h?: string | null) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—");

export const formatUsdc = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

export const arcTxUrl = (hash: string) => `${ARC_TESTNET_CONFIG.blockExplorers.default.url}/tx/${hash}`;
export const arcAddressUrl = (addr: string) => `${ARC_TESTNET_CONFIG.blockExplorers.default.url}/address/${addr}`;

export const STATE_LABEL: Record<string, string> = {
  UNFUNDED: "Awaiting funding",
  FUNDED: "Funded in escrow",
  SUBMITTED: "Work submitted",
  REVISION_REQUESTED: "Revision requested",
  APPROVED: "Approved",
  RELEASED: "Released to freelancer",
  DISPUTED: "In dispute",
  REFUNDED: "Refunded to client",
};

/**
 * Badge tones on warm paper. The previous values were dark-theme colours
 * (e.g. text-ink-3 on white), which failed contrast; these are tuned pairs.
 */
export const STATE_TONE: Record<string, string> = {
  UNFUNDED: "bg-idle-wash text-ink-2 border-rule-strong",
  FUNDED: "bg-royal-wash text-royal-deep border-royal/25",
  SUBMITTED: "bg-sage-wash text-sage-deep border-sage/40",
  REVISION_REQUESTED: "bg-warn-wash text-warn border-warn/25",
  APPROVED: "bg-ok-wash text-ok border-ok/25",
  RELEASED: "bg-ok-wash text-ok border-ok/25",
  DISPUTED: "bg-risk-wash text-risk border-risk/25",
  REFUNDED: "bg-idle-wash text-ink-2 border-rule-strong",
};

/** Same-origin error text for display: never dumps raw objects. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const any = e as { shortMessage?: string; message?: string };
    return (any.shortMessage ?? any.message ?? "Something went wrong").split("\n")[0]!.slice(0, 300);
  }
  return typeof e === "string" ? e : "Something went wrong";
}
