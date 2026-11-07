/**
 * Regression tests for the seam where the preflight meets the application's configuration.
 *
 * Reported failure: all five Hedera x402 variables were present and non-empty in apps/web/.env, and
 * @next/env's loadEnvConfig reported them LOADED, yet `npm run preflight:hedera` reported every one
 * as MISSING. The cause of that class of bug is always the same shape: the report is built from an
 * environment object that the loader has not populated, or was populated too late, or from a
 * different configuration source than the app reads.
 *
 * These tests pin the invariant end to end: variables that exist ONLY in an env file (absent from the
 * real process environment) must reach the report as SET, and the preflight must read the same files,
 * in the same precedence order, as the running Next.js app.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateKey } from "@x402/hedera";
import { loadWebEnv } from "../scripts/load-web-env";
import {
  runHederaPreflight,
  type HederaPreflightEnv,
  type HederaPreflightReport,
} from "../src/preflight";

const REQUIRED = [
  "HEDERA_AGENT_ACCOUNT_ID",
  "HEDERA_AGENT_PRIVATE_KEY",
  "HEDERA_FACILITATOR_ACCOUNT_ID",
  "HEDERA_FACILITATOR_PRIVATE_KEY",
  "HEDERA_SERVICE_RECIPIENT",
] as const;

/** Obviously fake, correctly shaped testnet values. Nothing here is a real credential. */
const AGENT = "0.0.7000001";
const FACILITATOR = "0.0.7000002";
const RECIPIENT = "0.0.7000003";
// Fabricated scalars, never used to sign. Agent ED25519, facilitator ECDSA, as in the real setup.
const AGENT_SCALAR = "4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";
const FACILITATOR_SCALAR = "6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1";
const AGENT_PUBLIC = PrivateKey.fromStringED25519(AGENT_SCALAR).publicKey.toStringRaw().toLowerCase();
const FACILITATOR_PUBLIC = PrivateKey.fromStringECDSA(FACILITATOR_SCALAR).publicKey.toStringRaw().toLowerCase();

const ENV_FILE_BODY = [
  `HEDERA_AGENT_ACCOUNT_ID=${AGENT}`,
  `HEDERA_AGENT_PRIVATE_KEY=${AGENT_SCALAR}`,
  `HEDERA_FACILITATOR_ACCOUNT_ID=${FACILITATOR}`,
  `HEDERA_FACILITATOR_PRIVATE_KEY=0x${FACILITATOR_SCALAR}`,
  `HEDERA_SERVICE_RECIPIENT=${RECIPIENT}`,
  `HEDERA_ALLOWED_PROVIDERS=${RECIPIENT}`,
  "",
].join("\n");

/** Healthy Mirror Node stub: reachable, both accounts visible and funded. */
const fetchImpl = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.includes("/network/nodes")) return new Response(JSON.stringify({ nodes: [] }), { status: 200 });
  const id = decodeURIComponent(/\/accounts\/([^?]+)/.exec(url)?.[1] ?? "");
  const key = id === AGENT
    ? { key: AGENT_PUBLIC, _type: "ED25519" }
    : { key: FACILITATOR_PUBLIC, _type: "ECDSA_SECP256K1" };
  return new Response(
    JSON.stringify({ account: id, deleted: false, balance: { balance: 1_000_000_000 }, key }),
    { status: 200 },
  );
}) as unknown as typeof fetch;

const stateOf = (report: HederaPreflightReport, name: string) => {
  const found = report.diagnostics.variables.find((variable) => variable.name === name);
  assert.ok(found, `expected a diagnostic row for ${name}`);
  return found.state;
};
const statusOf = (report: HederaPreflightReport, id: string) => {
  const found = report.checks.find((check) => check.id === id);
  assert.ok(found, `expected a check with id ${id}`);
  return found.status;
};

/** Runs `body` against a throwaway app directory, then restores the process environment exactly. */
async function withAppDir(files: Record<string, string>, body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "trustora-preflight-env-"));
  const saved = new Map<string, string | undefined>();
  for (const name of [...REQUIRED, "HEDERA_ALLOWED_PROVIDERS"]) saved.set(name, process.env[name]);
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    await body(dir);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("regression: variables present only in an env file reach the report as SET, not MISSING", async () => {
  await withAppDir({ ".env": ENV_FILE_BODY }, async (dir) => {
    // Precondition: this is the reported situation. The file has them; the process environment does not.
    for (const name of REQUIRED) {
      delete process.env[name];
      assert.equal(process.env[name], undefined, `${name} must start absent from process.env`);
    }

    // The exact reported symptom, reproduced: build the report without loading the files first.
    const unloaded = await runHederaPreflight({ env: process.env as HederaPreflightEnv, fetchImpl });
    for (const name of REQUIRED) {
      assert.equal(stateOf(unloaded, name), "MISSING", `${name} should be MISSING before the loader runs`);
    }
    assert.equal(statusOf(unloaded, "config.completeness"), "FAIL");

    // Load the app's configuration the way the app itself does, then report again.
    const { loadedFiles } = loadWebEnv(dir);
    assert.deepEqual(loadedFiles, [".env"], "the loader must actually have read the file");

    const loaded = await runHederaPreflight({ env: process.env as HederaPreflightEnv, fetchImpl });
    for (const name of REQUIRED) {
      assert.equal(stateOf(loaded, name), "SET", `${name} must be SET once the app's env is loaded`);
    }
    assert.equal(statusOf(loaded, "config.completeness"), "PASS");
    assert.equal(statusOf(loaded, "config.accountFormat"), "PASS");
    assert.equal(statusOf(loaded, "config.distinctAccounts"), "PASS");
    assert.equal(statusOf(loaded, "policy.allowlist"), "PASS");
    assert.equal(loaded.ok, true, `unexpected failures: ${JSON.stringify(loaded.failures)}`);
  });
});

test("regression: the runner loads configuration BEFORE building the report", async () => {
  // Ordering is the whole defect: a correct loader called after the report is built changes nothing.
  // This pins the runner's sequence so the two can never be reordered without a failing test.
  const source = await import("node:fs").then(({ readFileSync }) =>
    readFileSync(new URL("../scripts/hedera-preflight.ts", import.meta.url), "utf8"),
  );
  const loadAt = source.indexOf("loadWebEnv(");
  const reportAt = source.indexOf("runHederaPreflight(");
  assert.ok(loadAt > -1, "the runner must call loadWebEnv");
  assert.ok(reportAt > -1, "the runner must call runHederaPreflight");
  assert.ok(loadAt < reportAt, "loadWebEnv must be called before runHederaPreflight");
});

test("regression: the preflight reads the same env source and precedence as the app", async () => {
  // A second configuration source is how the preflight and the app drift apart. .env.local wins for
  // Next.js, so it must win here too, or the preflight would validate values the app never uses.
  await withAppDir(
    {
      ".env": ENV_FILE_BODY,
      ".env.local": `HEDERA_SERVICE_RECIPIENT=0.0.7000099\nHEDERA_ALLOWED_PROVIDERS=0.0.7000099\n`,
    },
    async (dir) => {
      for (const name of REQUIRED) delete process.env[name];
      const { loadedFiles } = loadWebEnv(dir);
      assert.deepEqual(loadedFiles, [".env.local", ".env"]);

      const report = await runHederaPreflight({ env: process.env as HederaPreflightEnv, fetchImpl });
      // The override is the value under test, and it still has to pass every structural check.
      assert.equal(stateOf(report, "HEDERA_SERVICE_RECIPIENT"), "SET");
      assert.equal(statusOf(report, "policy.allowlist"), "PASS");
      assert.equal(report.ok, true, `unexpected failures: ${JSON.stringify(report.failures)}`);
    },
  );
});

test("regression: no value from the env files appears anywhere in the report", async () => {
  await withAppDir({ ".env": ENV_FILE_BODY }, async (dir) => {
    for (const name of REQUIRED) delete process.env[name];
    loadWebEnv(dir);
    const report = await runHederaPreflight({ env: process.env as HederaPreflightEnv, fetchImpl });
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, new RegExp(AGENT_SCALAR, "i"), "the agent private scalar leaked");
    assert.doesNotMatch(serialized, new RegExp(FACILITATOR_SCALAR, "i"), "the facilitator private scalar leaked");
  });
});
