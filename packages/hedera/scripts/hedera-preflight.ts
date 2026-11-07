/**
 * Read-only Hedera x402 preflight runner.
 *
 *   npm run preflight:hedera
 *
 * Reports whether the dedicated testnet agent wallet, in-process facilitator, service recipient,
 * spending caps and Mirror Node are ready for a first live payment. It sends only HTTP GET requests
 * to the public Mirror Node, needs no key value, and has no code path that could move funds.
 *
 * Exits 1 if any check fails, so it can gate a demo script.
 */
import { runHederaPreflight, type CheckStatus, type HederaPreflightEnv } from "../src/preflight";
import { WEB_APP_DIR, loadWebEnv } from "./load-web-env";

const MARK: Record<CheckStatus, string> = { PASS: "PASS", FAIL: "FAIL", WARN: "WARN", SKIP: "SKIP" };

async function main(): Promise<void> {
  // Real process env wins; the app's env files fill the gaps, exactly as Next.js resolves them.
  const { loadedFiles } = loadWebEnv();
  const report = await runHederaPreflight({ env: process.env as HederaPreflightEnv });

  console.log("TRUSTORA — Hedera x402 live-testnet preflight (read-only)\n");
  console.log(`Env directory: ${WEB_APP_DIR}`);
  console.log(`Env files loaded: ${loadedFiles.length > 0 ? loadedFiles.join(", ") : "NONE FOUND"}\n`);

  const d = report.diagnostics;
  console.log("Variables (values are never shown):");
  for (const variable of d.variables) {
    const role = variable.required ? "required" : "legacy, optional";
    const format = variable.accountIdFormat === "NOT_APPLICABLE" || variable.accountIdFormat === "NOT_SET"
      ? ""
      : `  account ID format: ${variable.accountIdFormat}`;
    // A key that is merely present is reported as such, never as if it were usable.
    const keyVerdict = variable.keyValidity === "NOT_APPLICABLE"
      ? ""
      : `  key: ${variable.keyValidity}`;
    console.log(`  ${variable.name.padEnd(32)} ${variable.state.padEnd(8)} (${role})${format}${keyVerdict}`);
  }
  console.log(`  Accounts distinct:               ${d.accountsDistinct}`);
  console.log(`  Recipient allowlisted:           ${d.recipientAllowlisted}`);
  console.log(`  Facilitator testnet fee balance: ${d.facilitatorFeeBalance}\n`);

  for (const check of report.checks) {
    console.log(`[${MARK[check.status]}] ${check.title}`);
    console.log(`       ${check.detail}`);
    if (check.code) console.log(`       code: ${check.code}`);
  }

  const r = report.resolved;
  console.log("\nResolved configuration (no secret values are read or shown):");
  console.log(`  Network:           hedera:testnet (asset 0.0.0)`);
  console.log(`  Mirror Node:       ${r.mirrorNodeUrl}`);
  console.log(`  Service base URL:  ${r.serviceBaseUrl}`);
  console.log(`  Per-payment:       ${r.amountTinybars ?? "(invalid)"} tinybars`);
  console.log(`  Allowlist source:  ${r.allowlistSource} (${r.allowlist.length} entries)`);
  console.log(`  Autonomous paying: ${r.autopayEnabled ? "ARMED" : "DISABLED"}`);
  console.log(`  Per-payment approval required: ${r.requireApproval}`);

  console.log(
    `\n${report.ok ? "PREFLIGHT PASSED" : "PREFLIGHT FAILED"} — ${report.failures.length} failure(s), ${report.warnings.length} warning(s).`,
  );
  console.log("No transaction was authorised, submitted or funded by this check.");

  if (!report.ok) {
    console.log("\nFix the FAIL rows above, then run this again. Do not arm autonomous paying until it passes.");
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(`Preflight could not complete: ${err instanceof Error ? err.message : String(err)}`);
  console.error("No transaction was authorised, submitted or funded.");
  process.exitCode = 1;
});
