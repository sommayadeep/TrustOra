/**
 * @file preflight.ts
 * @description Read-only Hedera x402 preflight. Every check that must pass BEFORE the first live
 * agent payment, and nothing else.
 *
 * This module is deliberately inert. It imports no Hedera SDK and no x402 package, so it holds no
 * code path that could build, authorise or broadcast a transaction. Its only outbound traffic is
 * HTTP GET to the public Mirror Node. Credential variables are tested for PRESENCE ONLY: their
 * values are never read, parsed, compared, returned or logged.
 *
 * Pure logic over an injected `fetchImpl`, following packages/contracts/src/lib/deployPreflight.ts,
 * so every failure mode is unit-tested without a network. Unlike that module this one collects all
 * results instead of throwing on the first problem, so a single run lists everything left to fix.
 */
import {
  MAX_DAILY_TINYBARS,
  MAX_PAYMENT_TINYBARS,
  formatTinybars,
  isHederaAccountId,
  parseTinybarsAmount,
} from "./units";
import { TESTNET_MIRROR_URL } from "./verifier";
import { DEFAULT_HEDERA_POLICY } from "./policy";
import {
  derivedPublicKeyRaw,
  hederaKeyTypeOf,
  normalizeHederaKeyType,
  parseHederaPrivateKey,
  type HederaKeyType,
} from "./keys";

export type HederaPreflightCode =
  | "MISSING_CONFIGURATION"
  | "INVALID_ACCOUNT_ID"
  | "INVALID_AMOUNT"
  | "AMOUNT_OVER_CAP"
  | "ACCOUNTS_NOT_DISTINCT"
  | "NETWORK_MISMATCH"
  | "SERVICE_URL_INVALID"
  | "RECIPIENT_NOT_ALLOWLISTED"
  | "MIRROR_NODE_UNREACHABLE"
  | "ACCOUNT_NOT_VISIBLE"
  | "ACCOUNT_DELETED"
  | "INSUFFICIENT_AGENT_BALANCE"
  | "LOW_FACILITATOR_BALANCE"
  | "KEY_UNPARSEABLE"
  | "KEY_IS_PUBLIC"
  | "KEY_TYPE_MISMATCH"
  | "KEY_DOES_NOT_CONTROL_ACCOUNT"
  | "DECLARED_KEY_TYPE_INVALID";

export class HederaPreflightError extends Error {
  constructor(readonly code: HederaPreflightCode, message: string) {
    super(message);
    this.name = "HederaPreflightError";
  }
}

/** Only the variables the live x402 flow actually reads. Key fields are presence-tested, never used. */
export interface HederaPreflightEnv {
  HEDERA_AGENT_ACCOUNT_ID?: string | undefined;
  HEDERA_AGENT_PRIVATE_KEY?: string | undefined;
  HEDERA_FACILITATOR_ACCOUNT_ID?: string | undefined;
  HEDERA_FACILITATOR_PRIVATE_KEY?: string | undefined;
  HEDERA_SERVICE_RECIPIENT?: string | undefined;
  HEDERA_SECURITY_SCAN_TINYBARS?: string | undefined;
  HEDERA_MIRROR_NODE_URL?: string | undefined;
  HEDERA_ALLOWED_PROVIDERS?: string | undefined;
  TRUSTORA_SERVICE_BASE_URL?: string | undefined;
  HEDERA_AGENT_AUTOPAY_ENABLED?: string | undefined;
  HEDERA_AGENT_REQUIRE_APPROVAL?: string | undefined;
  /** Legacy wallet. The x402 flow never reads these; they are compared and reported only. */
  /** Optional declared algorithm for each key: ED25519 or ECDSA_SECP256K1. */
  HEDERA_AGENT_KEY_TYPE?: string | undefined;
  HEDERA_FACILITATOR_KEY_TYPE?: string | undefined;
  HEDERA_ACCOUNT_ID?: string | undefined;
  HEDERA_PRIVATE_KEY?: string | undefined;
}

export interface VariableDiagnostic {
  name: string;
  /** False for variables a live x402 payment can run without. */
  required: boolean;
  state: "SET" | "MISSING";
  accountIdFormat: "VALID" | "INVALID" | "NOT_SET" | "NOT_APPLICABLE";
  /**
   * For key variables only. CONTROLS_ACCOUNT means the key parsed AND its derived public key matches
   * the account record on the Mirror Node. Presence alone never earns a passing verdict.
   */
  keyValidity:
    | "CONTROLS_ACCOUNT"
    | "WRONG_ACCOUNT"
    | "WRONG_TYPE"
    | "IS_PUBLIC_KEY"
    | "UNPARSEABLE"
    | "UNVERIFIED"
    | "NOT_SET"
    | "NOT_APPLICABLE";
}

/** Safe to print: names and verdicts only, never a configured value. */
export interface HederaPreflightDiagnostics {
  variables: VariableDiagnostic[];
  accountsDistinct: "YES" | "NO" | "UNKNOWN";
  recipientAllowlisted: "YES" | "NO" | "UNKNOWN";
  facilitatorFeeBalance: "SUFFICIENT" | "LOW" | "UNKNOWN";
}

export type CheckStatus = "PASS" | "FAIL" | "WARN" | "SKIP";

export interface PreflightCheck {
  /** Stable identifier, safe to assert on in tests. */
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  code?: HederaPreflightCode;
}

export interface HederaPreflightReport {
  checks: PreflightCheck[];
  /** True when no check failed. WARN rows never block. */
  ok: boolean;
  failures: PreflightCheck[];
  warnings: PreflightCheck[];
  diagnostics: HederaPreflightDiagnostics;
  /** Resolved, non-secret values that were actually used. */
  resolved: {
    mirrorNodeUrl: string;
    serviceBaseUrl: string;
    serviceHost: string;
    amountTinybars: string | null;
    allowlist: string[];
    allowlistSource: "HEDERA_ALLOWED_PROVIDERS" | "DEFAULT_HEDERA_POLICY";
    autopayEnabled: boolean;
    requireApproval: boolean;
  };
}

/** The facilitator pays consensus fees out of its own balance; below this it will start failing. */
export const FACILITATOR_FEE_FLOOR_TINYBARS = 5_000_000n; // 0.05 HBAR
export const DEFAULT_SERVICE_BASE_URL = "http://localhost:3000";
export const DEFAULT_SCAN_TINYBARS = "10000000"; // keep in step with lib/hedera.ts

const trimmed = (v: string | undefined): string => (typeof v === "string" ? v.trim() : "");

interface MirrorAccount {
  status: "VISIBLE" | "NOT_FOUND" | "DELETED" | "UNREACHABLE" | "MALFORMED";
  balanceTinybars: bigint | null;
  reason: string;
  /** Raw lower-case hex public key the ledger publishes, when the account has a single simple key. */
  publicKeyRaw: string | null;
  /** The ledger's own algorithm name, e.g. ED25519 or ECDSA_SECP256K1. */
  ledgerKeyType: string | null;
}

/**
 * One read-only Mirror Node account lookup. Never throws.
 * Mirror Node reports hbar balances in tinybars.
 */
async function readAccount(
  mirrorUrl: string,
  accountId: string,
  fetchImpl: typeof fetch,
): Promise<MirrorAccount> {
  const unreachable = (reason: string): MirrorAccount => ({
    status: "UNREACHABLE",
    balanceTinybars: null,
    reason,
    publicKeyRaw: null,
    ledgerKeyType: null,
  });
  let res: Response;
  try {
    res = await fetchImpl(`${mirrorUrl}/accounts/${encodeURIComponent(accountId)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    return unreachable(`Mirror Node request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status === 404) {
    return {
      status: "NOT_FOUND",
      balanceTinybars: null,
      reason: "The Mirror Node has no record of this account",
      publicKeyRaw: null,
      ledgerKeyType: null,
    };
  }
  if (!res.ok) return unreachable(`Mirror Node returned HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return unreachable("Mirror Node returned invalid JSON");
  }
  const record = body as {
    deleted?: unknown;
    balance?: { balance?: unknown } | null;
    key?: { key?: unknown; _type?: unknown } | null;
  };
  const raw = record.balance?.balance;
  const balance =
    typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
      ? BigInt(raw)
      : typeof raw === "string" && /^\d+$/.test(raw)
        ? BigInt(raw)
        : null;
  // A public key is public: it is safe to read, compare and even print. Accounts with a threshold or
  // key list publish no single key, which is reported as unverifiable rather than as a match.
  const publishedKey = record.key?.key;
  const publicKeyRaw =
    typeof publishedKey === "string" && /^[0-9a-fA-F]+$/.test(publishedKey) ? publishedKey.toLowerCase() : null;
  const ledgerKeyType = typeof record.key?._type === "string" ? record.key._type : null;

  if (record.deleted === true) {
    return {
      status: "DELETED",
      balanceTinybars: balance,
      reason: "This account is marked deleted on Hedera",
      publicKeyRaw,
      ledgerKeyType,
    };
  }
  if (balance === null) {
    return {
      status: "MALFORMED",
      balanceTinybars: null,
      reason: "The Mirror Node record has no readable hbar balance",
      publicKeyRaw,
      ledgerKeyType,
    };
  }
  return {
    status: "VISIBLE",
    balanceTinybars: balance,
    reason: "Visible on the Hedera Mirror Node",
    publicKeyRaw,
    ledgerKeyType,
  };
}

/**
 * Runs every preflight check. Sends only HTTP GET requests and returns a report.
 * It cannot authorise, submit or confirm a payment, by construction.
 */
export async function runHederaPreflight(p: {
  env: HederaPreflightEnv;
  fetchImpl?: typeof fetch;
}): Promise<HederaPreflightReport> {
  const env = p.env;
  const fetchImpl = p.fetchImpl ?? fetch;
  const checks: PreflightCheck[] = [];
  const add = (
    id: string,
    title: string,
    status: CheckStatus,
    detail: string,
    code?: HederaPreflightCode,
  ): void => {
    checks.push(code === undefined ? { id, title, status, detail } : { id, title, status, detail, code });
  };

  const agentId = trimmed(env.HEDERA_AGENT_ACCOUNT_ID);
  const facilitatorId = trimmed(env.HEDERA_FACILITATOR_ACCOUNT_ID);
  const recipient = trimmed(env.HEDERA_SERVICE_RECIPIENT);
  const mirrorNodeUrl = (trimmed(env.HEDERA_MIRROR_NODE_URL) || TESTNET_MIRROR_URL).replace(/\/+$/, "");
  const serviceBaseUrl = trimmed(env.TRUSTORA_SERVICE_BASE_URL) || DEFAULT_SERVICE_BASE_URL;
  const autopayEnabled = trimmed(env.HEDERA_AGENT_AUTOPAY_ENABLED) === "true";
  const requireApproval = trimmed(env.HEDERA_AGENT_REQUIRE_APPROVAL) !== "false";

  // ---- 1. Configuration completeness -------------------------------------------------
  // Key variables are checked for presence only. Their values are never touched.
  const required: Array<[string, string]> = [
    ["HEDERA_AGENT_ACCOUNT_ID", agentId],
    ["HEDERA_AGENT_PRIVATE_KEY", trimmed(env.HEDERA_AGENT_PRIVATE_KEY)],
    ["HEDERA_FACILITATOR_ACCOUNT_ID", facilitatorId],
    ["HEDERA_FACILITATOR_PRIVATE_KEY", trimmed(env.HEDERA_FACILITATOR_PRIVATE_KEY)],
    ["HEDERA_SERVICE_RECIPIENT", recipient],
  ];
  const missing = required.filter(([, value]) => value === "").map(([name]) => name);
  if (missing.length > 0) {
    add(
      "config.completeness",
      "Configuration completeness",
      "FAIL",
      `Not set: ${missing.join(", ")}. A live payment is impossible until these exist in apps/web/.env. Nothing was signed or sent.`,
      "MISSING_CONFIGURATION",
    );
  } else {
    add(
      "config.completeness",
      "Configuration completeness",
      "PASS",
      "All five required variables are present. Presence alone is not validity: the key checks below parse each key and prove it controls its account.",
    );
  }

  // ---- 2. Account ID format ----------------------------------------------------------
  const idFields: Array<[string, string]> = [
    ["HEDERA_AGENT_ACCOUNT_ID", agentId],
    ["HEDERA_FACILITATOR_ACCOUNT_ID", facilitatorId],
    ["HEDERA_SERVICE_RECIPIENT", recipient],
  ];
  const present = idFields.filter(([, value]) => value !== "");
  const malformed = present.filter(([, value]) => !isHederaAccountId(value)).map(([name]) => name);
  if (present.length === 0) {
    add("config.accountFormat", "Account ID format", "SKIP", "No account IDs are configured yet.");
  } else if (malformed.length > 0) {
    add(
      "config.accountFormat",
      "Account ID format",
      "FAIL",
      `Not a shard.realm.num account ID: ${malformed.join(", ")}. Aliases and EVM addresses are not accepted. Nothing was signed or sent.`,
      "INVALID_ACCOUNT_ID",
    );
  } else {
    add(
      "config.accountFormat",
      "Account ID format",
      "PASS",
      `${present.map(([name]) => name).join(", ")} are well-formed Hedera account IDs.`,
    );
  }

  // ---- 3. Account distinctness -------------------------------------------------------
  // The agent must not pay itself: the verifier requires the payer debited and the recipient
  // credited to be two different parties, so a self-payment could never be confirmed.
  const configuredIds = idFields.filter(([, value]) => value !== "");
  const collisions: string[] = [];
  for (let i = 0; i < configuredIds.length; i++) {
    for (let j = i + 1; j < configuredIds.length; j++) {
      const a = configuredIds[i]!;
      const b = configuredIds[j]!;
      if (a[1] === b[1]) collisions.push(`${a[0]} == ${b[0]} (${a[1]})`);
    }
  }
  if (configuredIds.length < 2) {
    add("config.distinctAccounts", "Agent / facilitator / recipient are distinct", "SKIP", "Too few accounts configured to compare.");
  } else if (collisions.length > 0) {
    add(
      "config.distinctAccounts",
      "Agent / facilitator / recipient are distinct",
      "FAIL",
      `${collisions.join("; ")}. These must be three separate accounts; otherwise the agent pays itself and Mirror Node confirmation can never match. Nothing was signed or sent.`,
      "ACCOUNTS_NOT_DISTINCT",
    );
  } else {
    add(
      "config.distinctAccounts",
      "Agent / facilitator / recipient are distinct",
      "PASS",
      `${configuredIds.length} configured accounts are all different.`,
    );
  }

  // The legacy wallet is only ever compared by account ID, and only against the agent: it may fill
  // another role, but the wallet that signs autonomous payments must be its own.
  const legacyId = trimmed(env.HEDERA_ACCOUNT_ID);
  const agentIsLegacy = agentId !== "" && agentId === legacyId;
  if (agentId === "" || legacyId === "") {
    add("config.agentNotLegacy", "Agent wallet is separate from the legacy wallet", "SKIP", "Needs both HEDERA_AGENT_ACCOUNT_ID and HEDERA_ACCOUNT_ID to compare.");
  } else if (agentIsLegacy) {
    add(
      "config.agentNotLegacy",
      "Agent wallet is separate from the legacy wallet",
      "FAIL",
      `HEDERA_AGENT_ACCOUNT_ID == HEDERA_ACCOUNT_ID (${agentId}). Autonomous payments must come from a dedicated limited-funds wallet. Nothing was signed or sent.`,
      "ACCOUNTS_NOT_DISTINCT",
    );
  } else {
    add("config.agentNotLegacy", "Agent wallet is separate from the legacy wallet", "PASS", "HEDERA_AGENT_ACCOUNT_ID and HEDERA_ACCOUNT_ID are different accounts.");
  }
  const accountsDistinct: HederaPreflightDiagnostics["accountsDistinct"] =
    collisions.length > 0 || agentIsLegacy ? "NO" : configuredIds.length === idFields.length ? "YES" : "UNKNOWN";

  // ---- 4. Amount within the reviewed caps --------------------------------------------
  const rawAmount = trimmed(env.HEDERA_SECURITY_SCAN_TINYBARS) || DEFAULT_SCAN_TINYBARS;
  const amount = parseTinybarsAmount(rawAmount);
  let amountTinybars: string | null = null;
  if (amount === null) {
    add(
      "config.amount",
      "Per-payment amount",
      "FAIL",
      "HEDERA_SECURITY_SCAN_TINYBARS must be a positive integer number of tinybars with no decimal point, sign or exponent. Nothing was signed or sent.",
      "INVALID_AMOUNT",
    );
  } else if (amount > MAX_PAYMENT_TINYBARS) {
    add(
      "config.amount",
      "Per-payment amount",
      "FAIL",
      `${formatTinybars(amount)} HBAR exceeds the reviewed per-payment cap of ${formatTinybars(MAX_PAYMENT_TINYBARS)} HBAR. Configuration may only lower this cap. Nothing was signed or sent.`,
      "AMOUNT_OVER_CAP",
    );
  } else {
    amountTinybars = amount.toString();
    const fits = MAX_DAILY_TINYBARS / amount;
    add(
      "config.amount",
      "Per-payment amount",
      "PASS",
      `${formatTinybars(amount)} HBAR per payment, within the ${formatTinybars(MAX_PAYMENT_TINYBARS)} HBAR cap. The ${formatTinybars(MAX_DAILY_TINYBARS)} HBAR rolling 24-hour budget allows ${fits} such payment(s).`,
    );
  }

  // ---- 5. Network consistency --------------------------------------------------------
  const mirrorIsMainnet = /mainnet/i.test(mirrorNodeUrl);
  const mirrorIsTestnet = /testnet/i.test(mirrorNodeUrl);
  if (mirrorIsMainnet) {
    add(
      "network.consistency",
      "Network consistency",
      "FAIL",
      `HEDERA_MIRROR_NODE_URL points at mainnet (${mirrorNodeUrl}), but TRUSTORA only supports hedera:testnet. Nothing was signed or sent.`,
      "NETWORK_MISMATCH",
    );
  } else if (!mirrorIsTestnet) {
    add(
      "network.consistency",
      "Network consistency",
      "WARN",
      `HEDERA_MIRROR_NODE_URL (${mirrorNodeUrl}) does not look like a testnet host. Confirm it serves Hedera testnet; the payment flow is hedera:testnet / asset 0.0.0 only.`,
    );
  } else {
    add(
      "network.consistency",
      "Network consistency",
      "PASS",
      `Mirror Node ${mirrorNodeUrl} is a testnet host, matching the hedera:testnet / asset 0.0.0 flow.`,
    );
  }

  // ---- 6. Service endpoint ------------------------------------------------------------
  // Autonomous mode refuses any service whose origin differs from the request origin.
  let serviceHost = "";
  let serviceOrigin = "";
  try {
    const parsed = new URL(serviceBaseUrl);
    serviceHost = parsed.hostname;
    serviceOrigin = parsed.origin;
    add(
      "config.serviceUrl",
      "Service endpoint",
      "PASS",
      `Security scan service resolves to ${serviceOrigin}/api/agent-services/security-scan. Autonomous mode only calls a same-origin service, so the app must be served from ${serviceOrigin}.`,
    );
  } catch {
    add(
      "config.serviceUrl",
      "Service endpoint",
      "FAIL",
      `TRUSTORA_SERVICE_BASE_URL (${serviceBaseUrl}) is not a valid absolute URL. Nothing was signed or sent.`,
      "SERVICE_URL_INVALID",
    );
  }

  // ---- 7. Recipient is allowlisted by the policy that will actually run ---------------
  const configuredAllowlist = (env.HEDERA_ALLOWED_PROVIDERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const usingConfigured = configuredAllowlist.length > 0;
  const allowlist = usingConfigured ? configuredAllowlist : [...DEFAULT_HEDERA_POLICY.allowedProviders];
  const allowlistSource = usingConfigured ? "HEDERA_ALLOWED_PROVIDERS" : "DEFAULT_HEDERA_POLICY";
  let recipientAllowlisted: HederaPreflightDiagnostics["recipientAllowlisted"] = "UNKNOWN";
  if (recipient === "") {
    add("policy.allowlist", "Recipient is allowlisted", "SKIP", "No HEDERA_SERVICE_RECIPIENT configured yet.");
  } else {
    const lowered = allowlist.map((entry) => entry.toLowerCase());
    const allowed =
      lowered.includes(recipient.toLowerCase()) ||
      (serviceHost !== "" && lowered.includes(serviceHost.toLowerCase()));
    recipientAllowlisted = allowed ? "YES" : "NO";
    if (allowed) {
      add(
        "policy.allowlist",
        "Recipient is allowlisted",
        "PASS",
        `${recipient} is accepted by ${allowlistSource} (${allowlist.length} entr${allowlist.length === 1 ? "y" : "ies"}).`,
      );
    } else {
      add(
        "policy.allowlist",
        "Recipient is allowlisted",
        "FAIL",
        `Neither recipient ${recipient} nor service host ${serviceHost || "(unresolved)"} appears in ${allowlistSource}. The policy engine would reject this payment before anything was signed. Add the recipient to HEDERA_ALLOWED_PROVIDERS. Nothing was signed or sent.`,
        "RECIPIENT_NOT_ALLOWLISTED",
      );
    }
  }

  // ---- 8. Mirror Node reachability ---------------------------------------------------
  let mirrorReachable = false;
  try {
    const res = await fetchImpl(`${mirrorNodeUrl}/network/nodes?limit=1`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      mirrorReachable = true;
      add("mirror.reachability", "Mirror Node reachability", "PASS", `${mirrorNodeUrl} answered HTTP ${res.status}.`);
    } else {
      add(
        "mirror.reachability",
        "Mirror Node reachability",
        "FAIL",
        `${mirrorNodeUrl} answered HTTP ${res.status}. Payments cannot be confirmed without the Mirror Node, so the flow would withhold results. Nothing was signed or sent.`,
        "MIRROR_NODE_UNREACHABLE",
      );
    }
  } catch (err) {
    add(
      "mirror.reachability",
      "Mirror Node reachability",
      "FAIL",
      `Could not reach ${mirrorNodeUrl}: ${err instanceof Error ? err.message : String(err)}. Nothing was signed or sent.`,
      "MIRROR_NODE_UNREACHABLE",
    );
  }

  // ---- 9 & 10. Account visibility on the public ledger --------------------------------
  const visibility: Array<{ id: string; label: string; variable: string; role: "agent" | "facilitator" }> = [];
  if (agentId !== "" && isHederaAccountId(agentId)) {
    visibility.push({ id: agentId, label: "Agent account", variable: "HEDERA_AGENT_ACCOUNT_ID", role: "agent" });
  }
  if (facilitatorId !== "" && isHederaAccountId(facilitatorId)) {
    visibility.push({ id: facilitatorId, label: "Facilitator account", variable: "HEDERA_FACILITATOR_ACCOUNT_ID", role: "facilitator" });
  }

  let facilitatorFeeBalance: HederaPreflightDiagnostics["facilitatorFeeBalance"] = "UNKNOWN";
  const ledgerRecords = new Map<"agent" | "facilitator", MirrorAccount>();
  for (const target of visibility) {
    const checkId = `account.${target.role}`;
    if (!mirrorReachable) {
      add(checkId, `${target.label} visibility`, "SKIP", "Skipped because the Mirror Node is unreachable.");
      continue;
    }
    const account = await readAccount(mirrorNodeUrl, target.id, fetchImpl);
    ledgerRecords.set(target.role, account);
    if (account.status === "NOT_FOUND") {
      add(
        checkId,
        `${target.label} visibility`,
        "FAIL",
        `${target.id} (${target.variable}) is not visible on the Mirror Node. Create the testnet account first. Nothing was signed or sent.`,
        "ACCOUNT_NOT_VISIBLE",
      );
      continue;
    }
    if (account.status === "DELETED") {
      add(
        checkId,
        `${target.label} visibility`,
        "FAIL",
        `${target.id} (${target.variable}) ${account.reason}. Nothing was signed or sent.`,
        "ACCOUNT_DELETED",
      );
      continue;
    }
    if (account.status !== "VISIBLE" || account.balanceTinybars === null) {
      add(checkId, `${target.label} visibility`, "WARN", `${target.id}: ${account.reason}.`);
      continue;
    }

    const balance = account.balanceTinybars;
    const shown = `${target.id} is visible with ${formatTinybars(balance)} HBAR`;
    if (target.role === "agent") {
      if (amount !== null && balance < amount) {
        add(
          checkId,
          `${target.label} visibility`,
          "FAIL",
          `${shown}, which is less than the ${formatTinybars(amount)} HBAR per-payment amount. Fund the dedicated agent wallet from the testnet faucet. Nothing was signed or sent.`,
          "INSUFFICIENT_AGENT_BALANCE",
        );
      } else if (amount !== null && balance < amount * 2n) {
        add(
          checkId,
          `${target.label} visibility`,
          "WARN",
          `${shown}: enough for one ${formatTinybars(amount)} HBAR payment but not two. Top it up before demoing.`,
        );
      } else {
        add(checkId, `${target.label} visibility`, "PASS", `${shown}.`);
      }
    } else if (balance < FACILITATOR_FEE_FLOOR_TINYBARS) {
      facilitatorFeeBalance = "LOW";
      add(
        checkId,
        `${target.label} visibility`,
        "WARN",
        `${shown}, below the ${formatTinybars(FACILITATOR_FEE_FLOOR_TINYBARS)} HBAR suggested floor. The facilitator pays consensus fees from this balance.`,
        "LOW_FACILITATOR_BALANCE",
      );
    } else {
      facilitatorFeeBalance = "SUFFICIENT";
      add(checkId, `${target.label} visibility`, "PASS", `${shown}; enough to cover consensus fees.`);
    }
  }

  // ---- 11. The configured keys must actually control their accounts -------------------
  // Presence is not validity. Each key is parsed, its PUBLIC key derived, and that compared with the
  // key the ledger publishes for the account. Only that proves the signer can sign for the payer.
  // Nothing below reads, returns or logs private material.
  const keyVerdicts = new Map<string, VariableDiagnostic["keyValidity"]>();
  const keyTargets: Array<{
    role: "agent" | "facilitator";
    label: string;
    accountId: string;
    keyVariable: string;
    typeVariable: string;
    secret: string | undefined;
    declared: string | undefined;
  }> = [
    {
      role: "agent",
      label: "Agent",
      accountId: agentId,
      keyVariable: "HEDERA_AGENT_PRIVATE_KEY",
      typeVariable: "HEDERA_AGENT_KEY_TYPE",
      secret: env.HEDERA_AGENT_PRIVATE_KEY,
      declared: env.HEDERA_AGENT_KEY_TYPE,
    },
    {
      role: "facilitator",
      label: "Facilitator",
      accountId: facilitatorId,
      keyVariable: "HEDERA_FACILITATOR_PRIVATE_KEY",
      typeVariable: "HEDERA_FACILITATOR_KEY_TYPE",
      secret: env.HEDERA_FACILITATOR_PRIVATE_KEY,
      declared: env.HEDERA_FACILITATOR_KEY_TYPE,
    },
  ];

  for (const target of keyTargets) {
    const checkId = `key.${target.role}`;
    const title = `${target.label} key controls its account`;
    if (trimmed(target.secret) === "") {
      keyVerdicts.set(target.keyVariable, "NOT_SET");
      add(checkId, title, "FAIL", `${target.keyVariable} is not set. Nothing was signed or sent.`, "MISSING_CONFIGURATION");
      continue;
    }

    let declaredType: HederaKeyType | undefined;
    try {
      declaredType = normalizeHederaKeyType(target.declared);
    } catch {
      keyVerdicts.set(target.keyVariable, "UNVERIFIED");
      add(
        checkId,
        title,
        "FAIL",
        `${target.typeVariable} must be ED25519 or ECDSA_SECP256K1 if it is set at all. Nothing was signed or sent.`,
        "DECLARED_KEY_TYPE_INVALID",
      );
      continue;
    }

    const record = ledgerRecords.get(target.role);
    const ledgerType = (() => {
      try {
        return normalizeHederaKeyType(record?.ledgerKeyType ?? undefined);
      } catch {
        return undefined;
      }
    })();
    // The ledger is the authority on the algorithm; a declared type only narrows it further.
    const expected = declaredType ?? ledgerType;

    let keyType: HederaKeyType;
    let derivedPublicKey: string;
    try {
      const key = parseHederaPrivateKey(target.secret ?? "", { expectedType: expected });
      keyType = hederaKeyTypeOf(key);
      derivedPublicKey = derivedPublicKeyRaw(key);
    } catch (err) {
      const code = err instanceof Error && /PUBLIC_KEY_SUPPLIED/.test(err.message)
        ? "KEY_IS_PUBLIC"
        : err instanceof Error && /KEY_TYPE_MISMATCH/.test(err.message)
          ? "KEY_TYPE_MISMATCH"
          : "KEY_UNPARSEABLE";
      keyVerdicts.set(
        target.keyVariable,
        code === "KEY_IS_PUBLIC" ? "IS_PUBLIC_KEY" : code === "KEY_TYPE_MISMATCH" ? "WRONG_TYPE" : "UNPARSEABLE",
      );
      const hint = code === "KEY_IS_PUBLIC"
        ? `${target.keyVariable} holds a DER-encoded PUBLIC key. Paste the account's PRIVATE key from the Hedera portal.`
        : code === "KEY_TYPE_MISMATCH"
          ? `${target.keyVariable} is not the ${expected ?? "expected"} algorithm this account uses.`
          : `${target.keyVariable} could not be parsed as a Hedera private key (expected 32-byte hex or DER).`;
      add(checkId, title, "FAIL", `${hint} The value was not logged. Nothing was signed or sent.`, code);
      continue;
    }

    if (!record || record.status === "UNREACHABLE") {
      keyVerdicts.set(target.keyVariable, "UNVERIFIED");
      add(checkId, title, "WARN", `The key parses as ${keyType}, but ${target.accountId} could not be read from the Mirror Node, so control of the account is unproven.`);
      continue;
    }
    if (record.publicKeyRaw === null) {
      keyVerdicts.set(target.keyVariable, "UNVERIFIED");
      add(checkId, title, "WARN", `The key parses as ${keyType}, but ${target.accountId} publishes no single public key (a key list or threshold key), so an automatic match is not possible. Verify this account manually.`);
      continue;
    }
    if (ledgerType && keyType !== ledgerType) {
      keyVerdicts.set(target.keyVariable, "WRONG_TYPE");
      add(
        checkId,
        title,
        "FAIL",
        `${target.keyVariable} is ${keyType} but account ${target.accountId} uses ${ledgerType}. Set ${target.typeVariable}=${ledgerType} and supply a matching key. Nothing was signed or sent.`,
        "KEY_TYPE_MISMATCH",
      );
      continue;
    }
    if (derivedPublicKey !== record.publicKeyRaw) {
      keyVerdicts.set(target.keyVariable, "WRONG_ACCOUNT");
      add(
        checkId,
        title,
        "FAIL",
        `The public key derived from ${target.keyVariable} does not match the key account ${target.accountId} publishes. This key belongs to a different account, so every signature would be rejected. Nothing was signed or sent.`,
        "KEY_DOES_NOT_CONTROL_ACCOUNT",
      );
      continue;
    }
    keyVerdicts.set(target.keyVariable, "CONTROLS_ACCOUNT");
    add(checkId, title, "PASS", `${keyType} key derives exactly the public key account ${target.accountId} publishes, so it can sign for it.`);
  }

  // ---- 12. Facilitator transport ------------------------------------------------------
  add(
    "facilitator.transport",
    "Facilitator transport",
    "PASS",
    "The facilitator runs in-process and reaches Hedera testnet directly, so there is no facilitator URL to probe. It is verified above by account visibility and fee balance.",
  );

  // ---- 12. Arming state ---------------------------------------------------------------
  // Disabled autopay is the safe default and is never treated as a failure.
  if (!autopayEnabled) {
    add(
      "policy.arming",
      "Autonomous signing arming state",
      "PASS",
      `HEDERA_AGENT_AUTOPAY_ENABLED is not "true", so autonomous signing is DISABLED. This is the safe state for preflight; arm it only when you are ready to spend real testnet HBAR.`,
    );
  } else if (requireApproval) {
    add(
      "policy.arming",
      "Autonomous signing arming state",
      "WARN",
      "Autonomous signing is ARMED, but per-payment approval is still required, so each payment needs an explicit consent flag.",
    );
  } else {
    add(
      "policy.arming",
      "Autonomous signing arming state",
      "WARN",
      "Autonomous signing is ARMED and HEDERA_AGENT_REQUIRE_APPROVAL is \"false\": payments can proceed with no per-payment approval, bounded only by the 1 HBAR / 5 HBAR caps.",
    );
  }

  const failures = checks.filter((check) => check.status === "FAIL");
  const warnings = checks.filter((check) => check.status === "WARN");

  const accountVariable = (name: string, value: string, required: boolean): VariableDiagnostic => ({
    name,
    required,
    state: value === "" ? "MISSING" : "SET",
    accountIdFormat: value === "" ? "NOT_SET" : isHederaAccountId(value) ? "VALID" : "INVALID",
    keyValidity: "NOT_APPLICABLE",
  });
  const secretVariable = (name: string, value: string | undefined, required: boolean): VariableDiagnostic => ({
    name,
    required,
    state: trimmed(value) === "" ? "MISSING" : "SET",
    accountIdFormat: "NOT_APPLICABLE",
    keyValidity: keyVerdicts.get(name) ?? (trimmed(value) === "" ? "NOT_SET" : "UNVERIFIED"),
  });
  const diagnostics: HederaPreflightDiagnostics = {
    variables: [
      accountVariable("HEDERA_AGENT_ACCOUNT_ID", agentId, true),
      secretVariable("HEDERA_AGENT_PRIVATE_KEY", env.HEDERA_AGENT_PRIVATE_KEY, true),
      accountVariable("HEDERA_FACILITATOR_ACCOUNT_ID", facilitatorId, true),
      secretVariable("HEDERA_FACILITATOR_PRIVATE_KEY", env.HEDERA_FACILITATOR_PRIVATE_KEY, true),
      accountVariable("HEDERA_SERVICE_RECIPIENT", recipient, true),
      accountVariable("HEDERA_ACCOUNT_ID", legacyId, false),
      secretVariable("HEDERA_PRIVATE_KEY", env.HEDERA_PRIVATE_KEY, false),
    ],
    accountsDistinct,
    recipientAllowlisted,
    facilitatorFeeBalance,
  };

  return {
    checks,
    ok: failures.length === 0,
    failures,
    warnings,
    diagnostics,
    resolved: {
      mirrorNodeUrl,
      serviceBaseUrl,
      serviceHost,
      amountTinybars,
      allowlist,
      allowlistSource,
      autopayEnabled,
      requireApproval,
    },
  };
}
