import { BrokerClient } from "./compute";
import { RouterClient, routerConfigFromEnv, type RouterConfig } from "./router";
import { OgError, type IntegrationHealth, type OgChatClient } from "./types";

export * from "./types";
export {
  RouterClient,
  routerConfigFromEnv,
  TESTNET_ROUTER_BASE_URL,
  DEFAULT_ROUTER_BASE_URL,
  DEFAULT_ROUTER_MODEL,
  MAINNET_ROUTER_HOST,
} from "./router";
export { BrokerClient, DEFAULT_TESTNET_RPC } from "./compute";

/** Qualifying TRUSTORA evaluation path: 0G Private Computer Router only. */
export class PrivateComputerClient extends RouterClient {}

export function privateComputerConfigFromEnv(env: Record<string, string | undefined>): RouterConfig | null {
  return routerConfigFromEnv(env);
}

export function createPrivateComputerClientFromEnv(env: Record<string, string | undefined>): PrivateComputerClient | null {
  const config = privateComputerConfigFromEnv(env);
  return config ? new PrivateComputerClient(config) : null;
}

class NoClient implements OgChatClient {
  async chat(): Promise<never> {
    throw new OgError("NOT_CONFIGURED", "No 0G credentials configured (set ZG_ROUTER_API_KEY, or ZG_PRIVATE_KEY for the broker fallback)");
  }
  async healthCheck(): Promise<IntegrationHealth> {
    return { status: "NOT_CONFIGURED", detail: "no ZG_ROUTER_API_KEY or ZG_PRIVATE_KEY set", checkedAt: new Date().toISOString() };
  }
}

export type OgPath = "router" | "broker" | "none";

/** Prefers the Router (ZG_ROUTER_API_KEY), then the broker fallback (ZG_PRIVATE_KEY). Throws on a mainnet URL. */
export function createOgClientFromEnv(env: Record<string, string | undefined>): { client: OgChatClient; path: OgPath } {
  const router = routerConfigFromEnv(env);
  if (router) return { client: new RouterClient(router), path: "router" };
  const pk = env.ZG_PRIVATE_KEY?.trim();
  if (pk) {
    const cfg: ConstructorParameters<typeof BrokerClient>[0] = { privateKey: pk };
    if (env.ZG_RPC_URL?.trim()) cfg.rpcUrl = env.ZG_RPC_URL.trim();
    if (env.ZG_PROVIDER_ADDRESS?.trim()) cfg.providerAddress = env.ZG_PROVIDER_ADDRESS.trim();
    return { client: new BrokerClient(cfg), path: "broker" };
  }
  return { client: new NoClient(), path: "none" };
}
