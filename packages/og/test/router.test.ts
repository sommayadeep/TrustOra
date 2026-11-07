import { test } from "node:test";
import assert from "node:assert/strict";
import { RouterClient, routerConfigFromEnv, DEFAULT_ROUTER_BASE_URL, DEFAULT_ROUTER_MODEL } from "../src/router";
import { OgError } from "../src/types";

type Call = { url: string; init: RequestInit };
function mockFetch(responder: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const okBody = (extra: Record<string, unknown> = {}) => ({
  id: "chatcmpl-body-id", model: DEFAULT_ROUTER_MODEL,
  choices: [{ message: { role: "assistant", content: "hello" } }], ...extra,
});
const cfg = { apiKey: "sk-MOCK", baseUrl: DEFAULT_ROUTER_BASE_URL, model: DEFAULT_ROUTER_MODEL };
const req = { system: "sys", user: "usr" };
const bodyOf = (call: Call) => JSON.parse(String(call.init.body));
const header = (call: Call, name: string) => new Headers(call.init.headers).get(name);

test("sends Bearer authorization and the configured model", async () => {
  const mock = mockFetch(() => json(okBody({ x_0g_trace: { request_id: "req-1" } })));
  await new RouterClient({ ...cfg, fetchImpl: mock.fetchImpl }).chat({ ...req, maxTokens: 500 });
  const call = mock.calls[0]!;
  assert.equal(header(call, "authorization"), `Bearer ${cfg.apiKey}`);
  assert.equal(bodyOf(call).model, DEFAULT_ROUTER_MODEL);
  assert.equal(bodyOf(call).verify_tee, true);
});

test("preserves private trust mode", async () => {
  const mock = mockFetch(() => json(okBody({ x_0g_trace: { request_id: "req-1" } })));
  await new RouterClient({ ...cfg, trustMode: "private", fetchImpl: mock.fetchImpl }).chat(req);
  assert.equal(header(mock.calls[0]!, "x-0g-provider-trust-mode"), "private");
});

test("extracts provider request IDs without fabricating them", async () => {
  const trace = await new RouterClient({
    ...cfg, fetchImpl: mockFetch(() => json(okBody({ x_0g_trace: { request_id: "TRACE" } }))).fetchImpl,
  }).chat(req);
  assert.deepEqual([trace.requestId, trace.requestIdSource], ["TRACE", "x_0g_trace.request_id"]);
  const missing = new RouterClient({ ...cfg, fetchImpl: mockFetch(() => json({ choices: [{ message: { content: "x" } }] })).fetchImpl });
  await assert.rejects(missing.chat(req), (e: unknown) => e instanceof OgError && e.code === "NO_REQUEST_ID");
});

test("accepts reasoning metadata and content-part arrays, but rejects empty content", async () => {
  const response = okBody({
    choices: [{ message: { content: [{ type: "text", text: "{\"ok\":true}" }], reasoning_content: "internal" } }],
    usage: { completion_tokens_details: { reasoning_tokens: 12 } },
  });
  const parsed = await new RouterClient({ ...cfg, fetchImpl: mockFetch(() => json(response)).fetchImpl }).chat(req);
  assert.equal(parsed.content, "{\"ok\":true}");
  const empty = new RouterClient({ ...cfg, fetchImpl: mockFetch(() => json(okBody({ choices: [{ message: { content: "" } }] }))).fetchImpl });
  await assert.rejects(empty.chat(req), (e: unknown) => e instanceof OgError && e.code === "BAD_RESPONSE");
});

test("maps provider errors, timeouts, and redacts keys", async () => {
  const errorClient = new RouterClient({ ...cfg, apiKey: "sk-SECRET", fetchImpl: mockFetch(() => json({ error: "sk-SECRET" }, 401)).fetchImpl });
  await assert.rejects(errorClient.chat(req), (e: unknown) => e instanceof OgError && e.code === "NOT_CONFIGURED" && !e.message.includes("sk-SECRET"));
  const unavailable = new RouterClient({ ...cfg, fetchImpl: mockFetch(() => { throw new Error("network"); }).fetchImpl });
  await assert.rejects(unavailable.chat(req), (e: unknown) => e instanceof OgError && e.code === "UNAVAILABLE");
});

test("discovers models and reports configuration health", async () => {
  const mock = mockFetch((call) => call.url.endsWith("/models") ? json({ data: [{ id: "glm-5.3" }] }) : json(okBody({ x_0g_trace: { request_id: "r" } })));
  const client = new RouterClient({ apiKey: "sk-MOCK", baseUrl: DEFAULT_ROUTER_BASE_URL, fetchImpl: mock.fetchImpl });
  assert.deepEqual(await client.listModels(), ["glm-5.3"]);
  assert.equal((await client.healthCheck()).status, "CONFIGURED");
});

test("configuration requires a key and defaults to the verified Router", () => {
  assert.equal(routerConfigFromEnv({}), null);
  const configured = routerConfigFromEnv({ ZG_ROUTER_API_KEY: "sk-MOCK" });
  assert.equal(configured?.baseUrl, DEFAULT_ROUTER_BASE_URL);
  assert.equal(configured?.model, DEFAULT_ROUTER_MODEL);
  assert.equal(configured?.trustMode, "private");
  assert.throws(() => routerConfigFromEnv({ ZG_ROUTER_API_KEY: "sk-MOCK", ZG_ROUTER_BASE_URL: "https://example.invalid/v1" }), /official 0G Router host/i);
});
