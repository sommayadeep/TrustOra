import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FACILITATOR_FEE_FLOOR_TINYBARS,
  runHederaPreflight,
  type CheckStatus,
  type HederaPreflightEnv,
  type HederaPreflightReport,
} from "../src/preflight";
import { MAX_PAYMENT_TINYBARS } from "../src/units";
import { PrivateKey } from "@x402/hedera";

const AGENT = "0.0.1001";
const FACILITATOR = "0.0.1002";
const RECIPIENT = "0.0.1003";

// Fabricated scalars, never used to sign anything. The agent is ED25519 and the facilitator is
// ECDSA secp256k1, mirroring the real deployment so both parsing paths are exercised.
const AGENT_SCALAR = "4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";
const FACILITATOR_SCALAR = "6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1";
const AGENT_SECRET = AGENT_SCALAR; // bare hex: ED25519 by convention
const FACILITATOR_SECRET = `0x${FACILITATOR_SCALAR}`; // 0x-prefixed: ECDSA by convention
const AGENT_PUBLIC = PrivateKey.fromStringED25519(AGENT_SCALAR).publicKey.toStringRaw().toLowerCase();
const FACILITATOR_PUBLIC = PrivateKey.fromStringECDSA(FACILITATOR_SCALAR).publicKey.toStringRaw().toLowerCase();
/** Deliberately unparseable, to prove a rejected value never reaches the report. */
const FAKE_KEY = "NEVER-EMIT-THIS-SENTINEL-KEY-0000";

const baseEnv = (over: Partial<HederaPreflightEnv> = {}): HederaPreflightEnv => ({
  HEDERA_AGENT_ACCOUNT_ID: AGENT,
  HEDERA_AGENT_PRIVATE_KEY: AGENT_SECRET,
  HEDERA_FACILITATOR_ACCOUNT_ID: FACILITATOR,
  HEDERA_FACILITATOR_PRIVATE_KEY: FACILITATOR_SECRET,
  HEDERA_SERVICE_RECIPIENT: RECIPIENT,
  HEDERA_ALLOWED_PROVIDERS: RECIPIENT,
  ...over,
});

interface FakeNetwork {
  nodesStatus?: number;
  nodesThrows?: boolean;
  accounts?: Record<
    string,
    {
      status?: number;
      deleted?: boolean;
      balance?: number | string | null;
      /** Omit to simulate an account with no single published key (key list / threshold key). */
      key?: { key: string; _type: string } | null;
    }
  >;
}

/** Records every request so we can prove the checker only ever reads. */
function fakeFetch(net: FakeNetwork = {}) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/network/nodes")) {
      if (net.nodesThrows) throw new Error("connect ECONNREFUSED");
      const status = net.nodesStatus ?? 200;
      return new Response(JSON.stringify({ nodes: [] }), { status });
    }
    const match = /\/accounts\/([^?]+)/.exec(url);
    const id = match ? decodeURIComponent(match[1]!) : "";
    const record = net.accounts?.[id];
    if (!record) return new Response(JSON.stringify({ _status: {} }), { status: 404 });
    if (record.status && record.status !== 200) {
      return new Response(JSON.stringify({}), { status: record.status });
    }
    return new Response(
      JSON.stringify({
        account: id,
        deleted: record.deleted ?? false,
        balance: record.balance === null ? null : { balance: record.balance ?? 0 },
        key: record.key === undefined ? null : record.key,
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const agentLedgerKey = { key: AGENT_PUBLIC, _type: "ED25519" };
const facilitatorLedgerKey = { key: FACILITATOR_PUBLIC, _type: "ECDSA_SECP256K1" };
const healthyAccounts = {
  [AGENT]: { balance: 500_000_000, key: agentLedgerKey },
  [FACILITATOR]: { balance: 100_000_000, key: facilitatorLedgerKey },
};

const row = (report: HederaPreflightReport, id: string) => {
  const found = report.checks.find((check) => check.id === id);
  assert.ok(found, `expected a check with id "${id}"`);
  return found;
};
const statusOf = (report: HederaPreflightReport, id: string): CheckStatus => row(report, id).status;
const codes = (report: HederaPreflightReport) => report.failures.map((f) => f.code);

const run = (env: HederaPreflightEnv, net: FakeNetwork = { accounts: healthyAccounts }) =>
  runHederaPreflight({ env, fetchImpl: fakeFetch(net).impl });

test("a complete, funded, allowlisted configuration passes every check", async () => {
  const report = await run(baseEnv());
  assert.equal(report.ok, true, `unexpected failures: ${JSON.stringify(report.failures)}`);
  assert.deepEqual(report.failures, []);
  for (const id of [
    "config.completeness",
    "config.accountFormat",
    "config.distinctAccounts",
    "config.amount",
    "network.consistency",
    "config.serviceUrl",
    "policy.allowlist",
    "mirror.reachability",
    "account.agent",
    "account.facilitator",
    "policy.arming",
  ]) {
    assert.equal(statusOf(report, id), "PASS", `${id} should pass`);
  }
  assert.equal(report.resolved.amountTinybars, "10000000");
  assert.equal(report.resolved.autopayEnabled, false);
  assert.equal(report.resolved.requireApproval, true);
});

test("missing credentials are reported as incomplete configuration, naming each variable", async () => {
  const report = await run({});
  assert.equal(report.ok, false);
  const check = row(report, "config.completeness");
  assert.equal(check.code, "MISSING_CONFIGURATION");
  for (const name of [
    "HEDERA_AGENT_ACCOUNT_ID",
    "HEDERA_AGENT_PRIVATE_KEY",
    "HEDERA_FACILITATOR_ACCOUNT_ID",
    "HEDERA_FACILITATOR_PRIVATE_KEY",
    "HEDERA_SERVICE_RECIPIENT",
  ]) {
    assert.match(check.detail, new RegExp(name));
  }
  // With nothing configured there is nothing to compare or look up.
  assert.equal(statusOf(report, "config.accountFormat"), "SKIP");
  assert.equal(statusOf(report, "config.distinctAccounts"), "SKIP");
  assert.equal(statusOf(report, "policy.allowlist"), "SKIP");
});

test("malformed account IDs are rejected and EVM addresses are not accepted", async () => {
  const report = await run(baseEnv({ HEDERA_AGENT_ACCOUNT_ID: "0x" + "ab".repeat(20) }));
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes("INVALID_ACCOUNT_ID"));
  assert.match(row(report, "config.accountFormat").detail, /HEDERA_AGENT_ACCOUNT_ID/);
  // A malformed ID is never looked up on the Mirror Node.
  assert.equal(report.checks.some((check) => check.id === "account.agent"), false);
});

test("the agent, facilitator and recipient must be three different accounts", async () => {
  const report = await run(baseEnv({ HEDERA_SERVICE_RECIPIENT: AGENT, HEDERA_ALLOWED_PROVIDERS: AGENT }));
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes("ACCOUNTS_NOT_DISTINCT"));
  assert.match(row(report, "config.distinctAccounts").detail, /pays itself/i);
});

test("a per-payment amount above the reviewed cap is refused", async () => {
  const over = (MAX_PAYMENT_TINYBARS + 1n).toString();
  const report = await run(baseEnv({ HEDERA_SECURITY_SCAN_TINYBARS: over }));
  assert.equal(report.ok, false);
  assert.equal(row(report, "config.amount").code, "AMOUNT_OVER_CAP");
  assert.equal(report.resolved.amountTinybars, null);
});

test("a non-integer or decimal amount is refused rather than coerced", async () => {
  for (const bad of ["0.1", "1e8", "-10", "abc", "0", "010", "100 200"]) {
    const report = await run(baseEnv({ HEDERA_SECURITY_SCAN_TINYBARS: bad }));
    assert.equal(row(report, "config.amount").code, "INVALID_AMOUNT", `"${bad}" should be invalid`);
  }
});

test("surrounding whitespace in the amount is trimmed, matching the app's own parsing", async () => {
  // lib/hedera.ts reads HEDERA_SECURITY_SCAN_TINYBARS with .trim(), so the preflight must agree
  // with what the running app would actually charge rather than failing on an editing artifact.
  const report = await run(baseEnv({ HEDERA_SECURITY_SCAN_TINYBARS: "  25000000  " }));
  assert.equal(statusOf(report, "config.amount"), "PASS");
  assert.equal(report.resolved.amountTinybars, "25000000");
});

test("a recipient missing from the effective allowlist is caught before any signing", async () => {
  const report = await run(baseEnv({ HEDERA_ALLOWED_PROVIDERS: "" }));
  assert.equal(report.ok, false);
  const check = row(report, "policy.allowlist");
  assert.equal(check.code, "RECIPIENT_NOT_ALLOWLISTED");
  assert.equal(report.resolved.allowlistSource, "DEFAULT_HEDERA_POLICY");
  assert.match(check.detail, /HEDERA_ALLOWED_PROVIDERS/);
});

test("the default policy allowlist is used when no providers are configured", async () => {
  const report = await run(baseEnv({ HEDERA_ALLOWED_PROVIDERS: "", HEDERA_SERVICE_RECIPIENT: "0.0.482910" }));
  assert.equal(report.resolved.allowlistSource, "DEFAULT_HEDERA_POLICY");
  assert.equal(statusOf(report, "policy.allowlist"), "PASS");
});

test("a mainnet Mirror Node URL is a hard network mismatch", async () => {
  const report = await run(baseEnv({ HEDERA_MIRROR_NODE_URL: "https://mainnet.mirrornode.hedera.com/api/v1" }));
  assert.equal(report.ok, false);
  assert.equal(row(report, "network.consistency").code, "NETWORK_MISMATCH");
});

test("an unrecognised Mirror Node host warns but does not block", async () => {
  const report = await run(baseEnv({ HEDERA_MIRROR_NODE_URL: "https://mirror.example.com/api/v1" }), {
    accounts: healthyAccounts,
  });
  assert.equal(statusOf(report, "network.consistency"), "WARN");
  assert.equal(report.ok, true);
});

test("an invalid service base URL is refused", async () => {
  const report = await run(baseEnv({ TRUSTORA_SERVICE_BASE_URL: "not-a-url" }));
  assert.equal(report.ok, false);
  assert.equal(row(report, "config.serviceUrl").code, "SERVICE_URL_INVALID");
});

test("an unreachable Mirror Node fails and account lookups are skipped, not guessed", async () => {
  const report = await run(baseEnv(), { nodesThrows: true, accounts: healthyAccounts });
  assert.equal(report.ok, false);
  assert.equal(row(report, "mirror.reachability").code, "MIRROR_NODE_UNREACHABLE");
  assert.equal(statusOf(report, "account.agent"), "SKIP");
  assert.equal(statusOf(report, "account.facilitator"), "SKIP");
});

test("a Mirror Node 5xx is treated as unreachable", async () => {
  const report = await run(baseEnv(), { nodesStatus: 503, accounts: healthyAccounts });
  assert.equal(row(report, "mirror.reachability").code, "MIRROR_NODE_UNREACHABLE");
  assert.match(row(report, "mirror.reachability").detail, /503/);
});

test("an agent account the Mirror Node has never seen fails visibility", async () => {
  const report = await run(baseEnv(), { accounts: { [FACILITATOR]: { balance: 100_000_000, key: facilitatorLedgerKey } } });
  assert.equal(report.ok, false);
  assert.equal(row(report, "account.agent").code, "ACCOUNT_NOT_VISIBLE");
  assert.equal(statusOf(report, "account.facilitator"), "PASS");
});

test("a deleted account fails visibility", async () => {
  const report = await run(baseEnv(), {
    accounts: { [AGENT]: { balance: 500_000_000, deleted: true, key: agentLedgerKey }, [FACILITATOR]: { balance: 100_000_000 } },
  });
  assert.equal(row(report, "account.agent").code, "ACCOUNT_DELETED");
});

test("an agent balance below one payment fails; below two payments warns", async () => {
  const short = await run(baseEnv(), {
    accounts: { [AGENT]: { balance: 9_999_999, key: agentLedgerKey }, [FACILITATOR]: { balance: 100_000_000 } },
  });
  assert.equal(short.ok, false);
  assert.equal(row(short, "account.agent").code, "INSUFFICIENT_AGENT_BALANCE");

  const thin = await run(baseEnv(), {
    accounts: { [AGENT]: { balance: 15_000_000, key: agentLedgerKey }, [FACILITATOR]: { balance: 100_000_000 } },
  });
  assert.equal(thin.ok, true);
  assert.equal(statusOf(thin, "account.agent"), "WARN");
});

test("a facilitator below the fee floor warns without blocking, since it only pays fees", async () => {
  const report = await run(baseEnv(), {
    accounts: {
      [AGENT]: { balance: 500_000_000, key: agentLedgerKey },
      [FACILITATOR]: { balance: Number(FACILITATOR_FEE_FLOOR_TINYBARS) - 1, key: facilitatorLedgerKey },
    },
  });
  assert.equal(report.ok, true);
  assert.equal(row(report, "account.facilitator").code, "LOW_FACILITATOR_BALANCE");
});

test("a Mirror Node record with no readable balance warns instead of assuming zero", async () => {
  const report = await run(baseEnv(), {
    accounts: { [AGENT]: { balance: null, key: agentLedgerKey }, [FACILITATOR]: { balance: 100_000_000 } },
  });
  assert.equal(statusOf(report, "account.agent"), "WARN");
  assert.equal(report.ok, true);
});

test("disabled autonomous paying is the passing, safe state; arming it warns", async () => {
  const off = await run(baseEnv());
  assert.equal(statusOf(off, "policy.arming"), "PASS");
  assert.match(row(off, "policy.arming").detail, /DISABLED/);

  const armed = await run(baseEnv({ HEDERA_AGENT_AUTOPAY_ENABLED: "true" }));
  assert.equal(statusOf(armed, "policy.arming"), "WARN");
  assert.match(row(armed, "policy.arming").detail, /ARMED/);
  assert.equal(armed.ok, true, "arming is a warning, not a failure");

  const unattended = await run(
    baseEnv({ HEDERA_AGENT_AUTOPAY_ENABLED: "true", HEDERA_AGENT_REQUIRE_APPROVAL: "false" }),
  );
  assert.equal(statusOf(unattended, "policy.arming"), "WARN");
  assert.match(row(unattended, "policy.arming").detail, /no per-payment approval/i);
});

test("the facilitator is reported as in-process, with no URL to probe", async () => {
  const report = await run(baseEnv());
  assert.equal(statusOf(report, "facilitator.transport"), "PASS");
  assert.match(row(report, "facilitator.transport").detail, /in-process/i);
});

test("every request is a read: GET only, and only to the configured Mirror Node", async () => {
  const net = fakeFetch({ accounts: healthyAccounts });
  await runHederaPreflight({ env: baseEnv(), fetchImpl: net.impl });
  assert.ok(net.calls.length >= 3, "expected the nodes probe plus both account lookups");
  for (const call of net.calls) {
    const method = (call.init?.method ?? "GET").toUpperCase();
    assert.equal(method, "GET", `unexpected ${method} to ${call.url}`);
    assert.match(call.url, /^https:\/\/testnet\.mirrornode\.hedera\.com\/api\/v1\//);
  }
});

test("no credential value ever reaches the report", async () => {
  const report = await run(baseEnv());
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, new RegExp(FAKE_KEY));
  assert.doesNotMatch(serialized, new RegExp(AGENT_SCALAR, "i"), "the agent private scalar leaked");
  assert.doesNotMatch(serialized, new RegExp(FACILITATOR_SCALAR, "i"), "the facilitator private scalar leaked");
  assert.doesNotMatch(serialized, /PRIVATE_KEY["']?\s*:\s*["'][^"']+/);
});

test("the preflight module cannot authorise, submit or fund a payment", () => {
  // The preflight parses keys (it must, to prove they control their accounts) but must never be able
  // to sign, submit or move anything. keys.ts is in scope because the preflight now depends on it.
  const files = ["../src/preflight.ts", "../scripts/hedera-preflight.ts", "../scripts/load-web-env.ts", "../src/keys.ts"];
  for (const rel of files) {
    const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    // No SDK client, no transaction construction, no submission, no signing.
    assert.doesNotMatch(source, /Client\.for/, rel);
    assert.doesNotMatch(source, /TransferTransaction|AccountBalanceQuery|TokenAssociateTransaction/, rel);
    assert.doesNotMatch(source, /signAndSubmit|createClientHederaSigner|createHederaSignAndSubmitTransaction/, rel);
    assert.doesNotMatch(source, /createHederaX402Agent|prepareHederaX402Payment|settleAndVerifyX402Payment|createHederaX402Facilitator/, rel);
    assert.doesNotMatch(source, /\.execute\(|\.signTransaction\(|\bkey\.sign\(/, rel);
    // No state-changing HTTP verb anywhere.
    assert.doesNotMatch(source, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i, rel);
  }
  // Only keys.ts may touch the SDK key class at all, and only to parse and derive a public key.
  const preflight = readFileSync(fileURLToPath(new URL("../src/preflight.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(preflight, /\bPrivateKey\./, "the preflight must delegate key parsing to keys.ts");
});


const diagnosticFor = (report: HederaPreflightReport, name: string) => {
  const found = report.diagnostics.variables.find((variable) => variable.name === name);
  assert.ok(found, `expected a diagnostic for ${name}`);
  return found;
};

test("diagnostics report SET or MISSING for each variable, and never a value", async () => {
  const report = await run({
    HEDERA_ACCOUNT_ID: "0.0.2000",
    HEDERA_PRIVATE_KEY: FAKE_KEY,
    HEDERA_AGENT_PRIVATE_KEY: `  ${FAKE_KEY}  `,
    HEDERA_FACILITATOR_PRIVATE_KEY: "   ",
  });
  assert.equal(diagnosticFor(report, "HEDERA_AGENT_PRIVATE_KEY").state, "SET");
  assert.equal(diagnosticFor(report, "HEDERA_FACILITATOR_PRIVATE_KEY").state, "MISSING", "blank counts as missing");
  assert.equal(diagnosticFor(report, "HEDERA_AGENT_ACCOUNT_ID").state, "MISSING");
  assert.equal(diagnosticFor(report, "HEDERA_SERVICE_RECIPIENT").state, "MISSING");
  assert.equal(diagnosticFor(report, "HEDERA_AGENT_ACCOUNT_ID").required, true);
  assert.equal(diagnosticFor(report, "HEDERA_ACCOUNT_ID").required, false, "legacy variables never block x402");
  assert.equal(diagnosticFor(report, "HEDERA_PRIVATE_KEY").state, "SET");
  assert.doesNotMatch(JSON.stringify(report.diagnostics), new RegExp(FAKE_KEY));
});

test("diagnostics judge the format of account IDs only, never of keys", async () => {
  const report = await run(baseEnv({ HEDERA_SERVICE_RECIPIENT: "0xabc" }));
  assert.equal(diagnosticFor(report, "HEDERA_AGENT_ACCOUNT_ID").accountIdFormat, "VALID");
  assert.equal(diagnosticFor(report, "HEDERA_SERVICE_RECIPIENT").accountIdFormat, "INVALID");
  assert.equal(diagnosticFor(report, "HEDERA_AGENT_PRIVATE_KEY").accountIdFormat, "NOT_APPLICABLE");
  const unset = await run({});
  assert.equal(diagnosticFor(unset, "HEDERA_AGENT_ACCOUNT_ID").accountIdFormat, "NOT_SET");
});

test("diagnostics summarise distinctness, allowlisting and facilitator fee balance", async () => {
  const healthy = await run(baseEnv());
  assert.deepEqual(
    {
      accountsDistinct: healthy.diagnostics.accountsDistinct,
      recipientAllowlisted: healthy.diagnostics.recipientAllowlisted,
      facilitatorFeeBalance: healthy.diagnostics.facilitatorFeeBalance,
    },
    { accountsDistinct: "YES", recipientAllowlisted: "YES", facilitatorFeeBalance: "SUFFICIENT" },
  );

  const unset = await run({});
  assert.deepEqual(
    {
      accountsDistinct: unset.diagnostics.accountsDistinct,
      recipientAllowlisted: unset.diagnostics.recipientAllowlisted,
      facilitatorFeeBalance: unset.diagnostics.facilitatorFeeBalance,
    },
    { accountsDistinct: "UNKNOWN", recipientAllowlisted: "UNKNOWN", facilitatorFeeBalance: "UNKNOWN" },
  );

  const bad = await run(baseEnv({ HEDERA_FACILITATOR_ACCOUNT_ID: AGENT, HEDERA_ALLOWED_PROVIDERS: "0.0.9" }));
  assert.equal(bad.diagnostics.accountsDistinct, "NO");
  assert.equal(bad.diagnostics.recipientAllowlisted, "NO");

  const low = await run(baseEnv(), {
    accounts: { ...healthyAccounts, [FACILITATOR]: { balance: Number(FACILITATOR_FEE_FLOOR_TINYBARS) - 1 } },
  });
  assert.equal(low.diagnostics.facilitatorFeeBalance, "LOW");

  const offline = await run(baseEnv(), { nodesThrows: true });
  assert.equal(offline.diagnostics.facilitatorFeeBalance, "UNKNOWN");
});

test("the agent wallet must be separate from the legacy wallet", async () => {
  const shared = await run(baseEnv({ HEDERA_ACCOUNT_ID: AGENT }));
  assert.equal(statusOf(shared, "config.agentNotLegacy"), "FAIL");
  assert.ok(codes(shared).includes("ACCOUNTS_NOT_DISTINCT"));
  assert.equal(shared.diagnostics.accountsDistinct, "NO");

  const separate = await run(baseEnv({ HEDERA_ACCOUNT_ID: "0.0.2000" }));
  assert.equal(statusOf(separate, "config.agentNotLegacy"), "PASS");
  assert.equal(separate.ok, true);

  const noLegacy = await run(baseEnv());
  assert.equal(statusOf(noLegacy, "config.agentNotLegacy"), "SKIP");
  assert.equal(noLegacy.ok, true, "the legacy variables are optional for x402");
});

test("the legacy wallet may fill a non-agent role", async () => {
  const report = await run(baseEnv({ HEDERA_ACCOUNT_ID: RECIPIENT }));
  assert.equal(statusOf(report, "config.agentNotLegacy"), "PASS");
  assert.equal(report.ok, true);
});

// ---------------------------------------------------------------------------------------------
// Key-control checks: a key that is merely present must never produce PASS.
// ---------------------------------------------------------------------------------------------

/** A second ED25519 identity, to stand in for "a valid key, but for another account". */
const OTHER_SCALAR = "9a7bf1c40d2e5386b5c21f9e4d8a06b73ec5419f2d6a8b3c7e105f4a2b9c8d6e";
const OTHER_ED25519_PUBLIC = PrivateKey.fromStringED25519(OTHER_SCALAR).publicKey.toStringRaw().toLowerCase();

const keyVerdict = (report: HederaPreflightReport, name: string) => {
  const found = report.diagnostics.variables.find((variable) => variable.name === name);
  assert.ok(found, `expected a diagnostic row for ${name}`);
  return found.keyValidity;
};

test("a key that is merely present is not enough: an unparseable key fails", async () => {
  const report = await run(baseEnv({ HEDERA_AGENT_PRIVATE_KEY: FAKE_KEY }));
  assert.equal(report.ok, false, "a present-but-unusable key must not pass");
  const check = row(report, "key.agent");
  assert.equal(check.status, "FAIL");
  assert.equal(check.code, "KEY_UNPARSEABLE");
  // The variable is still SET, which is exactly why presence alone cannot be the verdict.
  assert.equal(statusOf(report, "config.completeness"), "PASS");
  assert.equal(keyVerdict(report, "HEDERA_AGENT_PRIVATE_KEY"), "UNPARSEABLE");
  assert.ok(!JSON.stringify(report).includes(FAKE_KEY));
});

test("a DER-encoded public key in a key variable is named as such", async () => {
  // This is the real Blocker 1 failure: the portal's public key pasted into the private key field.
  const publicDer = PrivateKey.fromStringED25519(AGENT_SCALAR).publicKey.toStringDer();
  const report = await run(baseEnv({ HEDERA_AGENT_PRIVATE_KEY: publicDer }));
  assert.equal(report.ok, false);
  const check = row(report, "key.agent");
  assert.equal(check.code, "KEY_IS_PUBLIC");
  assert.match(check.detail, /PUBLIC key/);
  assert.match(check.detail, /PRIVATE key/);
  assert.equal(keyVerdict(report, "HEDERA_AGENT_PRIVATE_KEY"), "IS_PUBLIC_KEY");
});

test("a valid key belonging to a different account fails the Mirror Node comparison", async () => {
  const report = await run(baseEnv(), {
    accounts: {
      // The ledger publishes someone else's ED25519 key for this account.
      [AGENT]: { balance: 500_000_000, key: { key: OTHER_ED25519_PUBLIC, _type: "ED25519" } },
      [FACILITATOR]: { balance: 100_000_000, key: facilitatorLedgerKey },
    },
  });
  assert.equal(report.ok, false);
  const check = row(report, "key.agent");
  assert.equal(check.code, "KEY_DOES_NOT_CONTROL_ACCOUNT");
  assert.match(check.detail, /different account/);
  assert.equal(keyVerdict(report, "HEDERA_AGENT_PRIVATE_KEY"), "WRONG_ACCOUNT");
});

test("a key whose algorithm contradicts the account's is rejected, not coerced", async () => {
  // A DER key is self-describing, so this is an unambiguous ED25519 key on an ECDSA account.
  const ed25519Der = PrivateKey.fromStringED25519(AGENT_SCALAR).toStringDer();
  const report = await run(baseEnv({ HEDERA_AGENT_PRIVATE_KEY: ed25519Der }), {
    accounts: {
      [AGENT]: { balance: 500_000_000, key: { key: FACILITATOR_PUBLIC, _type: "ECDSA_SECP256K1" } },
      [FACILITATOR]: { balance: 100_000_000, key: facilitatorLedgerKey },
    },
  });
  assert.equal(report.ok, false);
  assert.equal(row(report, "key.agent").code, "KEY_TYPE_MISMATCH");
  assert.equal(keyVerdict(report, "HEDERA_AGENT_PRIVATE_KEY"), "WRONG_TYPE");
});

test("an account with no single published key warns instead of claiming a match", async () => {
  const report = await run(baseEnv(), {
    accounts: {
      [AGENT]: { balance: 500_000_000, key: null }, // key list or threshold key
      [FACILITATOR]: { balance: 100_000_000, key: facilitatorLedgerKey },
    },
  });
  assert.equal(statusOf(report, "key.agent"), "WARN");
  assert.equal(keyVerdict(report, "HEDERA_AGENT_PRIVATE_KEY"), "UNVERIFIED");
  assert.match(row(report, "key.agent").detail, /no single public key/i);
  assert.equal(report.ok, true, "unverifiable is a warning, not a false failure");
});

test("control is unproven, not assumed, when the Mirror Node cannot be read", async () => {
  const report = await run(baseEnv(), { nodesThrows: true, accounts: healthyAccounts });
  assert.equal(statusOf(report, "key.agent"), "WARN");
  assert.match(row(report, "key.agent").detail, /unproven/i);
  assert.equal(keyVerdict(report, "HEDERA_AGENT_PRIVATE_KEY"), "UNVERIFIED");
});

test("a declared key type must be a real algorithm", async () => {
  const report = await run(baseEnv({ HEDERA_AGENT_KEY_TYPE: "rsa" }));
  assert.equal(report.ok, false);
  assert.equal(row(report, "key.agent").code, "DECLARED_KEY_TYPE_INVALID");
});

test("a declared key type overrides the 0x convention for bare hex", async () => {
  // The agent scalar read as ECDSA instead of ED25519: a different key, and the ledger says so.
  const ecdsaPublic = PrivateKey.fromStringECDSA(AGENT_SCALAR).publicKey.toStringRaw().toLowerCase();
  const report = await run(
    baseEnv({ HEDERA_AGENT_KEY_TYPE: "ECDSA_SECP256K1" }),
    {
      accounts: {
        [AGENT]: { balance: 500_000_000, key: { key: ecdsaPublic, _type: "ECDSA_SECP256K1" } },
        [FACILITATOR]: { balance: 100_000_000, key: facilitatorLedgerKey },
      },
    },
  );
  assert.equal(statusOf(report, "key.agent"), "PASS");
  assert.match(row(report, "key.agent").detail, /ECDSA_SECP256K1/);
  assert.equal(keyVerdict(report, "HEDERA_AGENT_PRIVATE_KEY"), "CONTROLS_ACCOUNT");
});

test("both keys are proven against their own accounts, and neither value is ever emitted", async () => {
  const report = await run(baseEnv());
  assert.equal(statusOf(report, "key.agent"), "PASS");
  assert.equal(statusOf(report, "key.facilitator"), "PASS");
  assert.match(row(report, "key.agent").detail, /ED25519/);
  assert.match(row(report, "key.facilitator").detail, /ECDSA_SECP256K1/);
  assert.equal(keyVerdict(report, "HEDERA_AGENT_PRIVATE_KEY"), "CONTROLS_ACCOUNT");
  assert.equal(keyVerdict(report, "HEDERA_FACILITATOR_PRIVATE_KEY"), "CONTROLS_ACCOUNT");

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, new RegExp(AGENT_SCALAR, "i"));
  assert.doesNotMatch(serialized, new RegExp(FACILITATOR_SCALAR, "i"));
});

test("a missing key variable fails the key check outright", async () => {
  const report = await run(baseEnv({ HEDERA_FACILITATOR_PRIVATE_KEY: "" }));
  assert.equal(report.ok, false);
  assert.equal(statusOf(report, "key.facilitator"), "FAIL");
  assert.equal(keyVerdict(report, "HEDERA_FACILITATOR_PRIVATE_KEY"), "NOT_SET");
});
