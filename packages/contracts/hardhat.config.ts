import "dotenv/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";

const ARC_TESTNET_RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

export default {
  plugins: [hardhatEthers, hardhatEthersChaiMatchers, hardhatMocha],
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: false,
    },
  },
  networks: {
    hardhat: {
      type: "edr-simulated" as const,
      chainId: 31337,
    },
    arcTestnet: {
      type: "http" as const,
      url: ARC_TESTNET_RPC,
      chainId: 5042002,
      ...(DEPLOYER_PRIVATE_KEY ? { accounts: [DEPLOYER_PRIVATE_KEY] } : {}),
    },
  },
  test: {
    mocha: {
      timeout: 40000,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
