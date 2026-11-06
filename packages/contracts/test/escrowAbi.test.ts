import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TRUSTORA_ESCROW_ABI } from "../src/lib/arc";

const artifactPath = join(dirname(fileURLToPath(import.meta.url)), "../artifacts/contracts/TrustoraEscrow.sol/TrustoraEscrow.json");

test("escrow ABI covers every function, dispute/refund path and event", () => {
  const fns: string[] = TRUSTORA_ESCROW_ABI.filter((x) => x.type === "function").map((x) => x.name);
  for (const f of ["createProject", "addMilestone", "fundMilestone", "submitMilestoneWork", "requestRevision",
    "releaseMilestone", "disputeMilestone", "resolveDispute", "refundMilestone", "getProject", "getMilestone"]) {
    assert.ok(fns.includes(f), `missing function ${f}`);
  }
  const events: string[] = TRUSTORA_ESCROW_ABI.filter((x) => x.type === "event").map((x) => x.name);
  for (const e of ["ProjectCreated", "MilestoneAdded", "MilestoneFunded", "MilestoneSubmitted", "RevisionRequested",
    "MilestoneReleased", "MilestoneRefunded", "MilestoneDisputed", "DisputeResolved"]) {
    assert.ok(events.includes(e), `missing event ${e}`);
  }
});

test("escrow ABI matches the compiled Hardhat artifact (no drift)", { skip: !existsSync(artifactPath) && "run `npm run compile:contracts` first" }, () => {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as { abi: unknown };
  assert.deepEqual(JSON.parse(JSON.stringify(TRUSTORA_ESCROW_ABI)), artifact.abi);
});
