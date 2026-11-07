import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const checkerPath = fileURLToPath(new URL("../scripts/check-deployment.ts", import.meta.url));
const checkerSource = readFileSync(checkerPath, "utf8");

test("deployment checker uses the Hardhat 3 network ethers provider", () => {
  assert.match(checkerSource, /import\s*\{\s*network\s*\}\s*from\s*["']hardhat["']/);
  assert.match(checkerSource, /await\s+network\.connect\(\)/);
  assert.match(checkerSource, /ethers\.provider/);
  assert.match(checkerSource, /fileURLToPath\(import\.meta\.url\)/);
  assert.doesNotMatch(checkerSource, /__dirname/);
  assert.doesNotMatch(checkerSource, /import\s*\{[^}]*\bethers\b[^}]*\}\s*from\s*["']hardhat["']/);
});

test("deployment checker is provider-only and cannot broadcast transactions", () => {
  assert.match(checkerSource, /new\s+Contract\(a,\s*ABI,\s*provider\)/);
  assert.match(checkerSource, /type\s+\{\s*Provider\s*\}\s*from\s*["']ethers["']/);
  assert.doesNotMatch(checkerSource, /getSigners|\.sendTransaction\s*\(|\.deploy\s*\(|deployContract\s*\(/);
  assert.doesNotMatch(checkerSource, /Wallet\s*\(|JsonRpcSigner/);
});
