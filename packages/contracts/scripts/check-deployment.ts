import { network } from "hardhat";
import type { Provider } from "ethers";
import { Contract } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { PreflightError, verifyDeployment } from "../src/lib/deployPreflight";

/**
 * Read-only check that ESCROW_CONTRACT_ADDRESS is a real, correctly wired TrustoraEscrow on Arc Testnet.
 * Sends no transaction and needs no key.
 *
 *   ESCROW_CONTRACT_ADDRESS=0x... npm run check:deployment -w @trustora/contracts
 *
 * (Falls back to deployments/arcTestnet.json when the variable is not set.)
 */
const ABI = [
  "function usdcToken() view returns (address)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
];

async function main() {
  let escrow = process.env.ESCROW_CONTRACT_ADDRESS?.trim();
  if (!escrow) {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const file = path.join(scriptDir, "../deployments/arcTestnet.json");
    if (fs.existsSync(file)) escrow = JSON.parse(fs.readFileSync(file, "utf8")).escrowContract;
  }
  // Hardhat 3 exposes plugin integrations on a connection, not as top-level exports.
  // Do not request signers here: this checker is intentionally provider-only and read-only.
  const { ethers } = await network.connect();
  const provider: Provider = ethers.provider;
  const at = (a: string) => new Contract(a, ABI, provider);
  const report = await verifyDeployment({
    escrow,
    reader: {
      getChainId: async () => (await provider.getNetwork()).chainId,
      getCode: (a) => provider.getCode(a),
      usdcToken: (a) => at(a).usdcToken(),
      owner: (a) => at(a).owner(),
      paused: (a) => at(a).paused(),
    },
  });
  console.log(`Network:   arcTestnet (chain ${report.chainId})`);
  console.log(`Escrow:    ${report.escrow}`);
  console.log(`USDC:      ${report.usdc}`);
  console.log(`Owner:     ${report.owner} (also the default arbiter and the only account that can pause)`);
  console.log(`Paused:    ${report.paused}`);
  console.log("OK: the escrow is deployed, wired to the expected USDC and ready.");
}

main().catch((error) => {
  console.error(
    error instanceof PreflightError
      ? `Check failed [${error.code}]: ${error.message}`
      : `Check failed: ${error?.shortMessage ?? error?.message ?? String(error)}`,
  );
  process.exitCode = 1;
});
