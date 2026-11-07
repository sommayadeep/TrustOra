// MOCK_ modules only: prove factory/broker LOGIC. The broker method names are UNVERIFIED against the real SDK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOgClientFromEnv } from "../src/index";
import { BrokerClient, type BrokerModules } from "../src/compute";
import { OgError } from "../src/types";

test("factory prefers router over broker", () => {
  const r = createOgClientFromEnv({ ZG_ROUTER_API_KEY: "sk-MOCK", ZG_PRIVATE_KEY: "0xMOCK" });
  assert.equal(r.path, "router");
});
test("factory uses broker when only a private key is set", () => {
  assert.equal(createOgClientFromEnv({ ZG_PRIVATE_KEY: "0xMOCK" }).path, "broker");
});
test("factory with nothing configured -> path none, chat throws NOT_CONFIGURED, health NOT_CONFIGURED", async () => {
  const r = createOgClientFromEnv({});
  assert.equal(r.path, "none");
  await assert.rejects(r.client.chat({ system: "s", user: "u" }), (e: unknown) => e instanceof OgError && e.code === "NOT_CONFIGURED");
  assert.equal((await r.client.healthCheck()).status, "NOT_CONFIGURED");
});
test("factory accepts the verified mainnet Router URL", () => {
  assert.equal(createOgClientFromEnv({ ZG_ROUTER_API_KEY: "sk-MOCK", ZG_ROUTER_BASE_URL: "https://router-api.0g.ai/v1" }).path, "router");
});

function MOCK_modules(over: { valid?: boolean; chatID?: string | null } = {}): BrokerModules {
  const broker = {
    inference: {
      listService: async () => [{ provider: "0xPROV", model: "MOCK_m", url: "https://mock-provider.invalid" }],
      getServiceMetadata: async () => ({ endpoint: "https://mock-provider.invalid/v1/proxy", model: "MOCK_m" }),
      getRequestHeaders: async () => ({ Authorization: "Bearer app-sk-MOCK" }),
      processResponse: async () => over.valid ?? true,
    },
  };
  return {
    createBroker: async () => broker,
    fetchImpl: (async () =>
      new Response(JSON.stringify({ id: "body-chat-id", model: "MOCK_m", choices: [{ message: { content: "hi" } }] }), {
        status: 200,
        headers: over.chatID === null ? {} : { "ZG-Res-Key": over.chatID ?? "CHAT-1" },
      })) as typeof fetch,
  };
}

test("broker: independent TEE check sets teeVerifiedBy=sdk-independent", async () => {
  const c = new BrokerClient({ privateKey: "0xMOCK", modules: MOCK_modules({ valid: true }) });
  const r = await c.chat({ system: "s", user: "u" });
  assert.equal(r.requestId, "CHAT-1");
  assert.equal(r.requestIdSource, "broker.chatID");
  assert.equal(r.teeVerified, true);
  assert.equal(r.teeVerifiedBy, "sdk-independent");
  assert.equal(r.providerAddress, "0xPROV");
});
test("broker: failed independent check -> teeVerified=false", async () => {
  const r = await new BrokerClient({ privateKey: "0xMOCK", modules: MOCK_modules({ valid: false }) }).chat({ system: "s", user: "u" });
  assert.equal(r.teeVerified, false);
});
test("broker: no chat id anywhere -> NO_REQUEST_ID", async () => {
  const mods = MOCK_modules({ chatID: null });
  mods.fetchImpl = (async () => new Response(JSON.stringify({ model: "m", choices: [{ message: { content: "x" } }] }), { status: 200 })) as typeof fetch;
  await assert.rejects(new BrokerClient({ privateKey: "0xMOCK", modules: mods }).chat({ system: "s", user: "u" }),
    (e: unknown) => e instanceof OgError && e.code === "NO_REQUEST_ID");
});
test("broker: SDK not installed -> NOT_CONFIGURED with clear message", async () => {
  const c = new BrokerClient({ privateKey: "0xMOCK" });
  await assert.rejects(c.chat({ system: "s", user: "u" }), (e: unknown) => e instanceof OgError && e.code === "NOT_CONFIGURED" && /not installed/i.test(e.message));
});
