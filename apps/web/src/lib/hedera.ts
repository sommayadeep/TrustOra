import {
  HederaAgentPayer,
  X402Challenge,
  AgentPaymentResult,
  StaticX402ServiceRegistry,
  isHederaAccountId,
  type X402ServiceDescriptor,
} from "../../../../packages/hedera/src/index";

export async function triggerHederaAgentPayment(
  resourceId: string,
  serviceType: "SECURITY_SCAN" | "CODE_QUALITY" = "SECURITY_SCAN"
): Promise<AgentPaymentResult> {
  const payer = new HederaAgentPayer();

  const challenge: X402Challenge = {
    scheme: "exact",
    network: "hedera:testnet",
    asset: "0.0.0",
    recipient: "0.0.482910", // Registered code auditor testnet account
    amountHbar: serviceType === "SECURITY_SCAN" ? 0.1 : 0.05,
    resourceId,
  };

  const providerHost = "audit.trustora.network";
  return await payer.executeAutonomousPayment(challenge, providerHost);
}

export function configuredHederaServices(): StaticX402ServiceRegistry {
  const recipient = process.env.HEDERA_SERVICE_RECIPIENT?.trim();
  if (!recipient) return new StaticX402ServiceRegistry([]);
  const baseUrl = process.env.TRUSTORA_SERVICE_BASE_URL?.trim() || "http://localhost:3000";
  const facilitator = process.env.HEDERA_FACILITATOR_ACCOUNT_ID?.trim() ?? "";
  return new StaticX402ServiceRegistry([
    {
      id: "security-scan",
      name: "TRUSTORA Security Scan",
      endpoint: `${baseUrl}/api/agent-services/security-scan`,
      recipient,
      amountTinybars: process.env.HEDERA_SECURITY_SCAN_TINYBARS?.trim() || "10000000",
      network: "hedera:testnet",
      asset: "0.0.0",
      description: "Machine-readable security scan service protected by Hedera x402 exact payments.",
      ...(isHederaAccountId(facilitator) ? { feePayer: facilitator } : {}),
    },
  ]);
}
