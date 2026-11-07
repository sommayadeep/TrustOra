/**
 * Integration test: real route handlers + real SQLite (scratch file) + a mocked Arc chain.
 * Run with TSX_TSCONFIG_PATH=apps/web/tsconfig.json so the "@/" alias resolves (see root package.json).
 * No network, no real keys: wallets are ephemeral in-test keys and the chain is an in-memory fake.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildAgreementMessage, buildLoginMessage } from "../src/lib/siwe";
import { TRUSTORA_ESCROW_ABI, projectIdToBytes32, toUsdcBaseUnits } from "../../../packages/contracts/src/lib/arc";

type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

const HOST = "localhost:3000";
const ESCROW = "0x1111111111111111111111111111111111111111";
const ARBITER_OWNER = "0x2222222222222222222222222222222222222222";

const client = privateKeyToAccount(generatePrivateKey());
const freelancer = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

let dir: string;
let db: PrismaClient;
let arcPublicClient: any;
const routes: Record<string, any> = {};

// ---- in-memory fake Arc chain ----
type Receipt = { status: "success" | "reverted"; from: string; to: string; blockNumber: bigint; logs: any[] };
const receipts = new Map<string, Receipt>();
const chain = {
  project: { client: client.address, freelancer: freelancer.address, arbiter: ARBITER_OWNER, exists: true },
  milestone: { criteriaHash: "0x", amount: 0n, state: 0, deliverableHash: "0x" + "0".repeat(64), deliverableUri: "" },
};
let txCounter = 0;
const newTx = () => `0x${(++txCounter).toString(16).padStart(64, "0")}`;

function evt(eventName: string, args: Record<string, unknown>, types: { type: string }[], values: unknown[]) {
  const topics = encodeEventTopics({ abi: TRUSTORA_ESCROW_ABI, eventName: eventName as never, args: args as never });
  const data = types.length ? encodeAbiParameters(types as never, values as never) : "0x";
  return { address: ESCROW, topics, data };
}
function mine(from: string, log: any, opts: { to?: string; status?: "success" | "reverted" } = {}) {
  const hash = newTx();
  receipts.set(hash, { status: opts.status ?? "success", from, to: opts.to ?? ESCROW, blockNumber: 100n + BigInt(txCounter), logs: [log] });
  return hash;
}

// ---- http helpers ----
async function call(handlerKey: string, opts: { method?: string; url?: string; cookie?: string; body?: unknown; params?: Record<string, string>; origin?: string; fn?: "GET" | "POST" } = {}) {
  const mod = routes[handlerKey];
  const method = opts.method ?? opts.fn ?? "POST";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin) headers.origin = opts.origin;
  const req = new Request(opts.url ?? `http://${HOST}/api/x`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
  });
  const res: Response = await (mod[method] as Handler)(req, { params: opts.params ?? {} });
  const json = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, json, res };
}

async function login(account: ReturnType<typeof privateKeyToAccount>): Promise<string> {
  const n = await call("nonce", { body: { address: account.address, role: account === freelancer ? "FREELANCER" : "CLIENT" } });
  const now = new Date();
  const message = buildLoginMessage({
    domain: HOST,
    address: account.address,
    uri: `http://${HOST}`,
    chainId: 5042002,
    nonce: n.json.nonce,
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + 600_000).toISOString(),
    role: account === freelancer ? "FREELANCER" : "CLIENT",
  });
  const signature = await account.signMessage({ message });
  const v = await call("verify", { url: `http://${HOST}/api/auth/verify`, body: { message, signature } });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  const setCookie = v.res.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  return setCookie.split(";")[0]!;
}

before(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith("ZG_")) delete process.env[k]; // never call a real AI provider
  process.env.ESCROW_CONTRACT_ADDRESS = ESCROW;

  dir = mkdtempSync(join(tmpdir(), "trustora-it-"));
  const schema = readFileSync(join(__dirname, "../prisma/schema.prisma"), "utf8").replace("file:./dev.db", `file:${join(dir, "test.db")}`);
  const schemaPath = join(dir, "schema.prisma");
  writeFileSync(schemaPath, schema);
  const prismaCli = require.resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", schemaPath], {
    stdio: "pipe",
    // Prisma 5.22's SQLite schema engine otherwise exits with an empty error in this test setup.
    env: { ...process.env, RUST_LOG: "info" },
  });

  db = new PrismaClient({ datasourceUrl: `file:${join(dir, "test.db")}` });
  (globalThis as any).prisma = db; // lib/prisma.ts reuses this instead of opening dev.db

  arcPublicClient = (await import("../src/lib/arc")).arcPublicClient;
  arcPublicClient.getTransactionReceipt = async ({ hash }: { hash: string }) => {
    const r = receipts.get(hash);
    if (!r) throw Object.assign(new Error("not found"), { name: "TransactionReceiptNotFoundError" });
    return r;
  };
  arcPublicClient.readContract = async ({ functionName }: { functionName: string }) =>
    functionName === "getProject" ? chain.project : chain.milestone;

  const p = "../src/app/api";
  routes.nonce = await import(`${p}/auth/nonce/route`);
  routes.verify = await import(`${p}/auth/verify/route`);
  routes.session = await import(`${p}/auth/session/route`);
  routes.logout = await import(`${p}/auth/logout/route`);
  routes.projects = await import(`${p}/projects/route`);
  routes.publish = await import(`${p}/projects/[id]/publish/route`);
  routes.applications = await import(`${p}/projects/[id]/applications/route`);
  routes.marketplace = await import(`${p}/marketplace/route`);
  routes.marketplaceDetail = await import(`${p}/marketplace/[id]/route`);
  routes.receivedApplications = await import(`${p}/applications/received/route`);
  routes.myApplications = await import(`${p}/applications/mine/route`);
  routes.apply = await import(`${p}/marketplace/[id]/apply/route`);
  routes.approve = await import(`${p}/projects/[id]/applications/[applicationId]/route`);
  routes.project = await import(`${p}/projects/[id]/route`);
  routes.invite = await import(`${p}/projects/[id]/invite/route`);
  routes.accept = await import(`${p}/projects/[id]/agreements/accept/route`);
  routes.register = await import(`${p}/projects/[id]/register/route`);
  routes.agentPayments = await import(`${p}/agent-payments/route`);
  routes.agentService = await import(`${p}/agent-services/[serviceId]/route`);
  routes.agentReconcile = await import(`${p}/agent-payments/reconcile/route`);
  routes.publicProof = await import(`${p}/public/prooftrack/route`);
  for (const a of ["register", "fund", "submit", "release", "dispute", "refund", "revision", "resolve", "evaluate"]) {
    routes[`m_${a}`] = await import(`${p}/projects/[id]/milestones/[milestoneId]/${a}/route`);
  }
});

after(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// Shared across the ordered tests below.
let cookieClient = "", cookieFreelancer = "", cookieStranger = "";
let projectId = "", milestoneId = "", criteriaHash = "";

test("every protected route rejects unauthenticated requests with 401", async () => {
  const P = { id: "TRU-PROJ-2026-0001042", milestoneId: "m1" };
  const checks: Array<[string, "GET" | "POST"]> = [
    ["projects", "GET"], ["projects", "POST"], ["project", "GET"], ["invite", "POST"], ["accept", "POST"], ["register", "POST"],
    ["m_register", "POST"], ["m_fund", "POST"], ["m_submit", "POST"], ["m_release", "POST"], ["m_dispute", "POST"],
    ["m_refund", "POST"], ["m_revision", "POST"], ["m_resolve", "POST"], ["m_evaluate", "POST"], ["agentPayments", "GET"], ["logout", "POST"],
  ];
  for (const [key, method] of checks) {
    const r = await call(key, { method, params: P, body: { txHash: "0x" + "ab".repeat(32), role: "CLIENT", clientAddress: client.address } });
    if (key === "logout") assert.equal(r.status, 200); // logging out while logged out is harmless
    else assert.equal(r.status, 401, `${method} ${key}`);
  }
});

test("login: nonce is single-use, domain-bound, and sessions are HttpOnly + revocable", async () => {
  // replay: the same signed message cannot create a second session
  const n = await call("nonce", { body: { address: client.address, role: "CLIENT" } });
  const now = new Date();
  const message = buildLoginMessage({ domain: HOST, address: client.address, uri: `http://${HOST}`, chainId: 5042002, nonce: n.json.nonce, issuedAt: now.toISOString(), expirationTime: new Date(now.getTime() + 600_000).toISOString(), role: "CLIENT" });
  const signature = await client.signMessage({ message });
  assert.equal((await call("verify", { body: { message, signature } })).status, 200);
  const replay = await call("verify", { body: { message, signature } });
  assert.equal(replay.status, 401);

  // a signature from another wallet / another domain / an unissued nonce is refused
  const n2 = await call("nonce", { body: { address: client.address, role: "CLIENT" } });
  const mk = (over: object) => buildLoginMessage({ domain: HOST, address: client.address, uri: `http://${HOST}`, chainId: 5042002, nonce: n2.json.nonce, issuedAt: now.toISOString(), expirationTime: new Date(now.getTime() + 600_000).toISOString(), role: "CLIENT", ...over });
  const m2 = mk({});
  assert.equal((await call("verify", { body: { message: m2, signature: await stranger.signMessage({ message: m2 }) } })).status, 401);
  const evil = mk({ domain: "evil.example" });
  assert.equal((await call("verify", { body: { message: evil, signature: await client.signMessage({ message: evil }) } })).status, 401);
  const unissued = mk({ nonce: "f".repeat(32) });
  assert.equal((await call("verify", { body: { message: unissued, signature: await client.signMessage({ message: unissued }) } })).status, 401);
  assert.equal((await call("verify", { body: {} })).status, 400);

  // session lifecycle
  cookieClient = await login(client);
  const s = await call("session", { method: "GET", cookie: cookieClient });
  assert.deepEqual([s.json.authenticated, s.json.address], [true, client.address.toLowerCase()]);
  assert.equal((await call("session", { method: "GET" })).json.authenticated, false);
  assert.equal((await call("logout", { cookie: cookieClient, origin: "https://evil.example" })).status, 403); // CSRF blocked
  const out = await call("logout", { cookie: cookieClient });
  assert.equal(out.status, 200);
  assert.equal((await call("session", { method: "GET", cookie: cookieClient })).json.authenticated, false);

  // the token in the DB is hashed, not the cookie value
  const raw = cookieClient.split("=")[1]!;
  assert.equal(await db.session.count({ where: { id: raw } }), 0);

  cookieClient = await login(client);
  cookieFreelancer = await login(freelancer);
  cookieStranger = await login(stranger);
});

test("registration role is signed, one-wallet-only, and concurrent creation is atomic", async () => {
  const oppositeNonce = await call("nonce", { body: { address: client.address, role: "FREELANCER" } });
  const now = new Date();
  const oppositeMessage = buildLoginMessage({
    domain: HOST,
    address: client.address,
    uri: `http://${HOST}`,
    chainId: 5042002,
    nonce: oppositeNonce.json.nonce,
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + 600_000).toISOString(),
    role: "FREELANCER",
  });
  const opposite = await call("verify", {
    body: { message: oppositeMessage, signature: await client.signMessage({ message: oppositeMessage }) },
  });
  assert.equal(opposite.status, 403);
  assert.match(opposite.json.error, /registered as CLIENT/);

  const racing = privateKeyToAccount(generatePrivateKey());
  const registerOnce = async () => {
    const n = await call("nonce", { body: { address: racing.address, role: "FREELANCER" } });
    const issued = new Date();
    const message = buildLoginMessage({
      domain: HOST,
      address: racing.address,
      uri: `http://${HOST}`,
      chainId: 5042002,
      nonce: n.json.nonce,
      issuedAt: issued.toISOString(),
      expirationTime: new Date(issued.getTime() + 600_000).toISOString(),
      role: "FREELANCER",
    });
    return call("verify", { body: { message, signature: await racing.signMessage({ message }) } });
  };
  const results = await Promise.all([registerOnce(), registerOnce()]);
  assert.deepEqual(results.map((r) => r.status).sort((a, b) => a - b), [200, 200]);
  assert.equal((await db.user.findUnique({ where: { walletAddress: racing.address.toLowerCase() } }))?.role, "FREELANCER");
});

test("agent payment history is private to the wallet session that requested it", async () => {
  await db.agentPayment.createMany({ data: [
    { id: "payment-client", idempotencyKey: "history-client", requestedByAddress: client.address.toLowerCase(), serviceName: "Client service", providerAccount: "0.0.7", amountTinybars: "10000000", status: "VERIFIED", policyDecision: "MIRROR_VERIFIED" },
    { id: "payment-freelancer", idempotencyKey: "history-freelancer", requestedByAddress: freelancer.address.toLowerCase(), serviceName: "Freelancer service", providerAccount: "0.0.8", amountTinybars: "20000000", status: "PENDING", policyDecision: "RESERVED" },
  ] });
  const clientHistory = await call("agentPayments", { method: "GET", cookie: cookieClient });
  const freelancerHistory = await call("agentPayments", { method: "GET", cookie: cookieFreelancer });
  assert.deepEqual(clientHistory.json.payments.map((p: any) => p.id), ["payment-client"]);
  assert.deepEqual(freelancerHistory.json.payments.map((p: any) => p.id), ["payment-freelancer"]);
});

test("x402 service advertises 402 requirements but refuses signed payment payloads without explicit consent", async () => {
  const oldRecipient = process.env.HEDERA_SERVICE_RECIPIENT;
  const oldBaseUrl = process.env.TRUSTORA_SERVICE_BASE_URL;
  process.env.HEDERA_SERVICE_RECIPIENT = "0.0.482910";
  process.env.TRUSTORA_SERVICE_BASE_URL = `http://${HOST}`;
  const before = await db.agentPayment.count();
  try {
    const challengeReq = new Request(`http://${HOST}/api/agent-services/security-scan`, {
      method: "POST",
      headers: { cookie: cookieClient, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const challenge = await routes.agentService.POST(challengeReq, { params: Promise.resolve({ serviceId: "security-scan" }) });
    assert.equal(challenge.status, 402);
    assert.ok(challenge.headers.get("PAYMENT-REQUIRED"));

    const noConsentReq = new Request(`http://${HOST}/api/agent-services/security-scan`, {
      method: "POST",
      headers: { cookie: cookieClient, "content-type": "application/json", "PAYMENT-SIGNATURE": "not-decoded-without-consent" },
      body: JSON.stringify({ consent: false }),
    });
    const denied = await routes.agentService.POST(noConsentReq, { params: Promise.resolve({ serviceId: "security-scan" }) });
    assert.equal(denied.status, 400);
    assert.equal((await denied.json()).status, "REJECTED_POLICY");
    assert.equal(await db.agentPayment.count(), before, "no reservation or settlement occurs without explicit consent");
  } finally {
    if (oldRecipient === undefined) delete process.env.HEDERA_SERVICE_RECIPIENT; else process.env.HEDERA_SERVICE_RECIPIENT = oldRecipient;
    if (oldBaseUrl === undefined) delete process.env.TRUSTORA_SERVICE_BASE_URL; else process.env.TRUSTORA_SERVICE_BASE_URL = oldBaseUrl;
  }
});

test("persistent x402 reservation rejects duplicates and enforces the rolling daily ceiling", async () => {
  const { reserveHederaSpend } = await import("../src/lib/hedera-ledger");
  await db.agentPayment.deleteMany({ where: { requestedByAddress: stranger.address.toLowerCase() } });
  assert.deepEqual(await reserveHederaSpend(450_000_000n, "mock-reservation-1", stranger.address), { allowed: true });
  assert.deepEqual(await reserveHederaSpend(10_000_000n, "mock-reservation-1", stranger.address), { allowed: false, reason: "DUPLICATE_PAYMENT" });
  assert.deepEqual(await reserveHederaSpend(60_000_000n, "mock-reservation-2", stranger.address), { allowed: false, reason: "DAILY_BUDGET_EXCEEDED" });
  await db.agentPayment.deleteMany({ where: { requestedByAddress: stranger.address.toLowerCase() } });
});

test("autonomous agent wallet budget is shared across authenticated requesters", async () => {
  const { reserveHederaSpend } = await import("../src/lib/hedera-ledger");
  await db.agentPayment.deleteMany({ where: { idempotencyKey: { in: ["mock-global-wallet-spend", "mock-global-wallet-overrun"] } } });
  assert.deepEqual(await reserveHederaSpend(450_000_000n, "mock-global-wallet-spend", stranger.address, "GLOBAL"), { allowed: true });
  assert.deepEqual(await reserveHederaSpend(60_000_000n, "mock-global-wallet-overrun", client.address, "GLOBAL"), { allowed: false, reason: "DAILY_BUDGET_EXCEEDED" });
  await db.agentPayment.deleteMany({ where: { idempotencyKey: { in: ["mock-global-wallet-spend", "mock-global-wallet-overrun"] } } });
});

test("pending facilitator settlement reconciles to Mirror Node verified and executes stored scan", async () => {
  const txId = "0.0.7@1700000000.000000000";
  const payment = await db.agentPayment.create({ data: {
    idempotencyKey: "mock-reconcile-verified", requestedByAddress: client.address.toLowerCase(), payerAccount: "0.0.7", projectId: null,
    serviceName: "TRUSTORA Security Scan", providerAccount: "0.0.482910", amountTinybars: "10000000", txId,
    status: "VERIFICATION_PENDING", policyDecision: "NOT_FOUND_YET", serviceInputJson: JSON.stringify({ "src/a.ts": "eval(input)" }),
  } });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ transactions: [{
    transaction_id: "0.0.7-1700000000-000000000", result: "SUCCESS", name: "CRYPTOTRANSFER", nonce: 0,
    consensus_timestamp: "1700000000.000000000", transfers: [{ account: "0.0.7", amount: -10000000 }, { account: "0.0.482910", amount: 10000000 }],
  }] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const req = new Request(`http://${HOST}/api/agent-payments/reconcile`, { method: "POST", headers: { cookie: cookieClient } });
    const response = await routes.agentReconcile.POST(req);
    const result = await response.json();
    assert.equal(result.updates.find((u: any) => u.id === payment.id)?.status, "VERIFIED");
    const persisted = await db.agentPayment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(persisted.status, "VERIFIED");
    assert.equal(JSON.parse(persisted.serviceResultJson!).findings[0].ruleId, "JS-EVAL");
  } finally { globalThis.fetch = previousFetch; await db.agentPayment.delete({ where: { id: payment.id } }); }
});

test("create project: client is the session wallet, never the request body", async () => {
  const body = { title: "Escrow dashboard", description: "Build an escrow dashboard with tests", freelancerAddress: freelancer.address, budgetUsdc: "250", clientAddress: stranger.address, role: "FREELANCER" };
  const r = await call("projects", { cookie: cookieClient, body });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.project.clientAddress, client.address.toLowerCase());
  assert.equal(r.json.project.freelancerAddress, freelancer.address.toLowerCase());
  assert.equal(r.json.project.status, "DRAFT");
  projectId = r.json.project.id;
  milestoneId = r.json.project.milestones[0].id;
  criteriaHash = r.json.project.milestones[0].criteriaHash;
  assert.equal(r.json.project.milestones[0].amountUsdc, 250);
  assert.match(criteriaHash, /^[0-9a-f]{64}$/);
});

test("create project validation", async () => {
  const base = { title: "T", description: "D", freelancerAddress: freelancer.address, budgetUsdc: "10" };
  for (const bad of [
    { ...base, freelancerAddress: "not-an-address" },
    { ...base, freelancerAddress: "0x123" },
    { ...base, freelancerAddress: client.address },
    { ...base, budgetUsdc: "1.1234567" },
    { ...base, budgetUsdc: "0" },
    { ...base, budgetUsdc: "-5" },
    { ...base, title: "" },
    { ...base, milestones: [{ title: "a", amountUsdc: "4" }, { title: "b", amountUsdc: "4" }] }, // sums to 8, not 10
    { ...base, milestones: [] },
    { ...base, customCriteria: [{ text: "" }] },
  ]) {
    const r = await call("projects", { cookie: cookieClient, body: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const ok = await call("projects", { cookie: cookieClient, body: { ...base, milestones: [{ title: "a", amountUsdc: "4" }, { title: "b", amountUsdc: "6" }] } });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.json.project.milestones.map((m: any) => m.milestoneIndex), [1, 2]);
});

test("visibility: only participants can list or open a project", async () => {
  assert.ok((await call("projects", { method: "GET", cookie: cookieClient })).json.projects.some((p: any) => p.id === projectId));
  assert.ok((await call("projects", { method: "GET", cookie: cookieFreelancer })).json.projects.some((p: any) => p.id === projectId));
  assert.equal((await call("projects", { method: "GET", cookie: cookieStranger })).json.projects.length, 0);
  const own = await call("project", { method: "GET", cookie: cookieFreelancer, params: { id: projectId } });
  assert.equal(own.status, 200);
  assert.deepEqual(own.json.viewer.roles, ["freelancer"]);
  assert.equal(own.json.chain.escrowAddress, ESCROW);
  assert.equal((await call("project", { method: "GET", cookie: cookieStranger, params: { id: projectId } })).status, 404);
});

test("marketplace only exposes published projects and enforces freelancer applications", async () => {
  assert.equal((await call("marketplace", { method: "GET", cookie: cookieFreelancer })).json.projects.some((p: any) => p.id === projectId), false);
  assert.equal((await call("publish", { cookie: cookieFreelancer, params: { id: projectId }, body: {} })).status, 403);
  assert.equal((await call("publish", { cookie: cookieClient, params: { id: projectId }, body: {} })).status, 200);
  const listed = await call("marketplace", { method: "GET", cookie: cookieFreelancer });
  assert.ok(listed.json.projects.some((p: any) => p.id === projectId));
  const detail = await call("marketplaceDetail", { method: "GET", cookie: cookieFreelancer, params: { id: projectId } });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.project.clientAddress, client.address.toLowerCase());
  assert.equal((await call("apply", { cookie: cookieClient, params: { id: projectId }, body: {} })).status, 403);
  assert.equal((await call("apply", { cookie: cookieFreelancer, params: { id: projectId }, body: { message: "I can deliver this." } })).status, 201);
  assert.equal((await call("apply", { cookie: cookieFreelancer, params: { id: projectId }, body: {} })).status, 409);
  const mine = await call("myApplications", { method: "GET", cookie: cookieFreelancer });
  assert.equal(mine.status, 200);
  assert.equal(mine.json.applications.length, 1);
  assert.equal((await call("receivedApplications", { method: "GET", cookie: cookieClient })).json.applications.length, 1);
  const applications = await call("applications", { method: "GET", cookie: cookieClient, params: { id: projectId } });
  assert.equal(applications.status, 200);
  assert.equal(applications.json.applications.length, 1);
  assert.equal((await call("applications", { method: "GET", cookie: cookieFreelancer, params: { id: projectId } })).status, 403);
  const applicationId = applications.json.applications[0].id;
  assert.equal((await call("approve", { cookie: cookieFreelancer, params: { id: projectId, applicationId }, body: {} })).status, 403);
  assert.equal((await call("approve", { cookie: cookieClient, params: { id: projectId, applicationId }, body: {} })).status, 200);
});

test("client invitations are wallet-bound and freelancer assignment freezes when accepted", async () => {
  const assigned = await call("invite", { cookie: cookieClient, params: { id: projectId }, body: { freelancerAddress: freelancer.address } });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.json));
  assert.equal(assigned.json.freelancerAddress, freelancer.address.toLowerCase());
  assert.equal((await call("invite", { cookie: cookieFreelancer, params: { id: projectId }, body: { freelancerAddress: stranger.address } })).status, 404);
  assert.equal((await call("invite", { cookie: cookieClient, params: { id: projectId }, body: { freelancerAddress: client.address } })).status, 400);
  assert.equal((await call("invite", { cookie: cookieStranger, params: { id: projectId }, body: { freelancerAddress: stranger.address } })).status, 404);
  const invite = await call("projects", { method: "GET", cookie: cookieFreelancer });
  assert.ok(invite.json.projects.some((p: any) => p.id === projectId), "assigned wallet sees its invitation");
});

test("on-chain registration and funding are refused until the agreement is locked", async () => {
  const tx = newTx();
  assert.equal((await call("register", { cookie: cookieClient, params: { id: projectId }, body: { txHash: tx } })).status, 409);
  const unknown = await call("m_fund", { cookie: cookieClient, params: { id: projectId, milestoneId }, body: { txHash: tx } });
  assert.equal(unknown.json.code, "RECEIPT_NOT_FOUND", "an unmined/unknown hash is never recorded");
  assert.equal(await mstate(), "UNFUNDED");
});

test("agreement acceptance: freelancer only, signature verified, then locked", async () => {
  const P = { id: projectId };
  assert.equal((await call("accept", { cookie: cookieClient, params: P, body: {} })).status, 403); // client already accepted
  assert.equal((await call("accept", { cookie: cookieStranger, params: P, body: {} })).status, 404);
  assert.equal((await call("accept", { cookie: cookieFreelancer, params: P, body: { role: "CLIENT" } })).status, 400); // no signature
  assert.equal((await call("accept", { cookie: cookieFreelancer, params: P, body: { signature: "sig_freelancer_verified" } })).status, 401); // placeholder rejected

  const message = buildAgreementMessage({ projectId, versionNumber: 1, criteriaHash, role: "FREELANCER" });
  const wrongSigner = await stranger.signMessage({ message });
  assert.equal((await call("accept", { cookie: cookieFreelancer, params: P, body: { signature: wrongSigner } })).status, 401);
  const wrongMessage = await freelancer.signMessage({ message: buildAgreementMessage({ projectId, versionNumber: 1, criteriaHash: "0".repeat(64), role: "FREELANCER" }) });
  assert.equal((await call("accept", { cookie: cookieFreelancer, params: P, body: { signature: wrongMessage } })).status, 401);

  const ok = await call("accept", { cookie: cookieFreelancer, params: P, body: { signature: await freelancer.signMessage({ message }) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.bothAccepted, true);
  assert.equal((await db.project.findUnique({ where: { id: projectId } }))!.status, "AGREED");
  assert.equal((await call("invite", { cookie: cookieClient, params: P, body: { freelancerAddress: stranger.address } })).status, 409);
  const again = await call("accept", { cookie: cookieFreelancer, params: P, body: {} });
  assert.equal(again.json.alreadyAccepted, true);
});

test("register project on-chain: verified from the chain, never assumed from the DB", async () => {
  const P = { id: projectId };
  const pid = projectIdToBytes32(projectId);
  const created = (arbiter = ARBITER_OWNER) =>
    evt("ProjectCreated", { projectId: pid, client: client.address, freelancer: freelancer.address }, [{ type: "address" }, { type: "uint64" }], [arbiter, 1n]);

  // not the client / wrong sender / wrong contract / reverted
  const good = mine(client.address, created());
  assert.equal((await call("register", { cookie: cookieFreelancer, params: P, body: { txHash: good } })).status, 403);
  assert.equal((await call("register", { cookie: cookieStranger, params: P, body: { txHash: good } })).status, 404);
  assert.equal((await call("register", { cookie: cookieClient, params: P, body: { txHash: mine(stranger.address, created()) } })).json.code, "SENDER_NOT_AUTHORIZED");
  assert.equal((await call("register", { cookie: cookieClient, params: P, body: { txHash: mine(client.address, created(), { to: "0x9999999999999999999999999999999999999999" }) } })).json.code, "WRONG_CONTRACT");
  assert.equal((await call("register", { cookie: cookieClient, params: P, body: { txHash: mine(client.address, created(), { status: "reverted" }) } })).json.code, "TX_REVERTED");
  assert.equal((await call("register", { cookie: cookieClient, params: P, body: { txHash: newTx() } })).json.code, "RECEIPT_NOT_FOUND");
  assert.equal((await call("register", { cookie: cookieClient, params: P, body: { txHash: "nope" } })).json.code, "INVALID_TX_HASH");
  assert.equal((await db.project.findUnique({ where: { id: projectId } }))!.registerTxHash, null, "nothing recorded for rejected txs");
  assert.equal(await db.proofTrackEventRecord.count({ where: { projectId, eventType: "ESCROW_PROJECT_REGISTERED" } }), 0);

  const r = await call("register", { cookie: cookieClient, params: P, body: { txHash: good } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = await db.project.findUnique({ where: { id: projectId } });
  assert.equal(row!.registerTxHash, good);
  assert.equal(row!.arbiterAddress, ARBITER_OWNER, "adopts the arbiter the contract stores");
  const ev = await db.proofTrackEventRecord.findFirstOrThrow({ where: { projectId, eventType: "ESCROW_PROJECT_REGISTERED" } });
  assert.equal(ev.verificationStatus, "VERIFIED");
  assert.equal(ev.referenceValue, good);
  assert.equal((await call("register", { cookie: cookieClient, params: P, body: { txHash: good } })).status, 200); // idempotent
  assert.equal(await db.proofTrackEventRecord.count({ where: { projectId, eventType: "ESCROW_PROJECT_REGISTERED" } }), 1);
});

test("register milestone on-chain", async () => {
  const P = { id: projectId, milestoneId };
  const pid = projectIdToBytes32(projectId);
  const added = (amount: bigint, hash = "0x" + criteriaHash) =>
    evt("MilestoneAdded", { projectId: pid, milestoneId: 1n }, [{ type: "bytes32" }, { type: "uint256" }], [hash, amount]);
  chain.milestone = { criteriaHash: "0x" + criteriaHash, amount: toUsdcBaseUnits(250), state: 0, deliverableHash: "0x" + "0".repeat(64), deliverableUri: "" };

  assert.equal((await call("m_register", { cookie: cookieClient, params: P, body: { txHash: mine(client.address, added(toUsdcBaseUnits(249))) } })).json.code, "AMOUNT_MISMATCH");
  assert.equal((await call("m_register", { cookie: cookieClient, params: P, body: { txHash: mine(client.address, added(toUsdcBaseUnits(250), "0x" + "e".repeat(64))) } })).json.code, "CRITERIA_MISMATCH");
  assert.equal((await call("m_register", { cookie: cookieFreelancer, params: P, body: { txHash: mine(client.address, added(toUsdcBaseUnits(250))) } })).status, 403);
  assert.equal((await db.milestone.findUnique({ where: { id: milestoneId } }))!.addTxHash, null);

  const good = mine(client.address, added(toUsdcBaseUnits(250)));
  const r = await call("m_register", { cookie: cookieClient, params: P, body: { txHash: good } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await db.milestone.findUnique({ where: { id: milestoneId } }))!.addTxHash, good);
});

async function syncCall(action: string, who: string, txHash: string) {
  return call(`m_${action}`, { cookie: who, params: { id: projectId, milestoneId }, body: { txHash } });
}
const mstate = async () => (await db.milestone.findUnique({ where: { id: milestoneId } }))!.state;
const pstatus = async () => (await db.project.findUnique({ where: { id: projectId } }))!.status;

test("fund: role-gated, chain-verified, state read from the contract", async () => {
  const pid = projectIdToBytes32(projectId);
  const funded = evt("MilestoneFunded", { projectId: pid, milestoneId: 1n, client: client.address }, [{ type: "uint256" }, { type: "uint64" }], [toUsdcBaseUnits(250), 1n]);
  const tx = mine(client.address, funded);
  chain.milestone.state = 1; // Funded

  assert.equal((await syncCall("fund", cookieFreelancer, tx)).status, 403); // freelancer cannot fund
  assert.equal((await syncCall("fund", cookieStranger, tx)).status, 404);
  assert.equal(await mstate(), "UNFUNDED");
  assert.equal((await syncCall("fund", cookieClient, mine(stranger.address, funded))).json.code, "SENDER_NOT_AUTHORIZED");
  assert.equal(await mstate(), "UNFUNDED", "a rejected tx never changes state");

  const r = await syncCall("fund", cookieClient, tx);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.chainState, "Funded");
  assert.equal(await mstate(), "FUNDED");
  assert.equal(await pstatus(), "FUNDED");
  assert.equal((await db.milestone.findUnique({ where: { id: milestoneId } }))!.fundingTxHash, tx);
  const ev = await db.proofTrackEventRecord.findFirstOrThrow({ where: { projectId, referenceValue: tx } });
  assert.deepEqual([ev.ecosystem, ev.verificationStatus, ev.eventType], ["ARC", "VERIFIED", "ESCROW_FUNDED"]);
  assert.match(ev.explorerUrl ?? "", /^https:\/\/explorer\.testnet\.arc\.io\/tx\/0x/);

  const again = await syncCall("fund", cookieClient, tx); // idempotent
  assert.equal(again.status, 200);
  assert.equal(again.json.changed, false);
  assert.equal(await db.proofTrackEventRecord.count({ where: { projectId, referenceValue: tx } }), 1);
});

test("submit: off-chain step does not change state; on-chain step must anchor the stored hash", async () => {
  const P = { id: projectId, milestoneId };
  const pid = projectIdToBytes32(projectId);
  assert.equal((await call("m_submit", { cookie: cookieClient, params: P, body: { deliverableContent: "x" } })).status, 403); // client cannot submit work
  assert.equal((await call("m_submit", { cookie: cookieFreelancer, params: P, body: { deliverableContent: "x", txHash: "0x1" } })).status, 400);

  const tooBig = await call("m_submit", { cookie: cookieFreelancer, params: P, body: { deliverableContent: "z".repeat(24_001) } });
  assert.equal(tooBig.status, 413, "text the evaluator cannot fully read is refused, not silently truncated");
  assert.equal(await db.submission.count({ where: { milestoneId } }), 0);

  const content = "export function add(a:number,b:number){return a+b}";
  const stored = await call("m_submit", { cookie: cookieFreelancer, params: P, body: { deliverableContent: content, deliverableUri: "ipfs://real-cid" } });
  assert.equal(stored.status, 200, JSON.stringify(stored.json));
  assert.equal(await mstate(), "FUNDED", "storing text alone must not mark the milestone submitted");
  assert.equal(stored.json.anchor.deliverableHash, `0x${stored.json.deliverableHash}`);
  const submissionId = stored.json.submission.id;
  assert.equal(stored.json.submission.deliverableUri, "ipfs://real-cid");

  const submitted = (hash: string) => evt("MilestoneSubmitted", { projectId: pid, milestoneId: 1n, freelancer: freelancer.address }, [{ type: "bytes32" }, { type: "string" }, { type: "uint64" }], [hash, "ipfs://real-cid", 1n]);
  chain.milestone.state = 2;
  chain.milestone.deliverableHash = stored.json.anchor.deliverableHash;
  const wrong = await call("m_submit", { cookie: cookieFreelancer, params: P, body: { txHash: mine(freelancer.address, submitted("0x" + "f".repeat(64))), submissionId } });
  assert.equal(wrong.json.code, "DELIVERABLE_MISMATCH");
  assert.equal(await mstate(), "FUNDED");

  const ok = await call("m_submit", { cookie: cookieFreelancer, params: P, body: { txHash: mine(freelancer.address, submitted(stored.json.anchor.deliverableHash)), submissionId } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(await mstate(), "SUBMITTED");
  assert.equal(await pstatus(), "IN_PROGRESS");
  // text can't be re-stored once submitted (state guard)
  assert.equal((await call("m_submit", { cookie: cookieFreelancer, params: P, body: { deliverableContent: "again" } })).status, 409);
});

test("evaluate: client-only, explicit consent, honest UNABLE_TO_ASSESS without a model, never touches escrow", async () => {
  const P = { id: projectId, milestoneId };
  const paymentsBefore = await db.agentPayment.count();
  assert.equal((await call("m_evaluate", { cookie: cookieFreelancer, params: P, body: { aiConsent: true } })).status, 403);
  assert.equal((await call("m_evaluate", { cookie: cookieClient, params: P, body: {} })).json.code, "CONSENT_REQUIRED");
  assert.equal((await call("m_evaluate", { cookie: cookieClient, params: P, body: { aiConsent: "yes" } })).status, 400);

  // Only the submission anchored on Arc is evaluated: a newer, never-anchored text and a tampered text are both refused/ignored.
  const anchored = await db.submission.findFirstOrThrow({ where: { milestoneId, anchorTxHash: { not: null } } });
  assert.ok(anchored.anchorTxHash, "the submit sync marks the anchored submission");
  const decoy = await db.submission.create({ data: { milestoneId, version: 99, deliverableHash: "9".repeat(64), content: "decoy never anchored" } });
  await db.submission.update({ where: { id: anchored.id }, data: { content: "tampered after anchoring" } });
  const tampered = await call("m_evaluate", { cookie: cookieClient, params: P, body: { aiConsent: true } });
  assert.equal(tampered.status, 409, "stored text no longer matches the anchored hash");
  assert.match(tampered.json.error, /does not match its anchored hash/);
  await db.submission.update({ where: { id: anchored.id }, data: { content: anchored.content } });

  const r = await call("m_evaluate", { cookie: cookieClient, params: P, body: { aiConsent: true } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.report.submissionId, anchored.id, "evaluated the anchored submission, not the newer decoy");
  await db.submission.delete({ where: { id: decoy.id } });
  assert.equal(r.json.advisoryOnly, true);
  assert.equal(r.json.modelCalled, false);
  assert.equal(r.json.report.overallVerdict, "UNABLE_TO_ASSESS");
  assert.equal(r.json.report.inferenceRequestId, null, "no inference ID may be invented");
  assert.equal(r.json.report.advisoryNotice, "ADVISORY_ONLY_CANNOT_RELEASE_FUNDS");
  assert.equal(await mstate(), "SUBMITTED", "evaluation never moves escrow state");
  assert.equal(await db.proofTrackEventRecord.count({ where: { projectId, ecosystem: "ZERO_G" } }), 0);
  assert.equal(await db.agentPayment.count(), paymentsBefore, "evaluation does not create a simulated Hedera payment");
});

test("evaluate: mocked Private Computer Router result persists and is linked in ProofTrack", async () => {
  const saved = {
    apiKey: process.env.ZG_ROUTER_API_KEY,
    baseUrl: process.env.ZG_ROUTER_BASE_URL,
    model: process.env.ZG_ROUTER_MODEL,
    trustMode: process.env.ZG_ROUTER_TRUST_MODE,
    fetch: globalThis.fetch,
  };
  const agreement = await db.agreementVersion.findFirstOrThrow({ where: { projectId }, orderBy: { versionNumber: "desc" } });
  const criteria = JSON.parse(agreement.criteriaJson) as Array<{ id: string; text: string }>;
  process.env.ZG_ROUTER_API_KEY = "sk-MOCK-ONLY";
  process.env.ZG_ROUTER_BASE_URL = "https://router-api.0g.ai/v1";
  process.env.ZG_ROUTER_MODEL = "glm-5.3";
  process.env.ZG_ROUTER_TRUST_MODE = "private";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.match(String(input), /router-api\.0g\.ai\/v1\/chat\/completions/);
    const request = JSON.parse(String(init?.body)) as { model: string; verify_tee: boolean; messages: Array<{ role: string; content: string }> };
    assert.equal(request.model, "glm-5.3");
    assert.equal(request.verify_tee, true);
    assert.equal(request.messages.length, 2);
    const body = {
      id: "chatcmpl-mock-evaluation",
      model: "glm-5.3",
      choices: [{
        message: {
          role: "assistant",
          content: JSON.stringify({
            results: criteria.map((c) => ({ id: c.id, verdict: "PASS", evidence: "Mocked Router evidence" })),
            limitations: ["Mocked provider response; manual review remains required."],
          }),
          reasoning_content: "Optional reasoning metadata",
        },
        finish_reason: "stop",
      }],
      usage: { completion_tokens_details: { reasoning_tokens: 4 } },
      x_0g_trace: { request_id: "chatcmpl-mock-evaluation", provider: "mock-private-provider" },
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const beforeState = await mstate();
    const response = await call("m_evaluate", { cookie: cookieClient, params: { id: projectId, milestoneId }, body: { aiConsent: true } });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(response.json.advisoryOnly, true);
    assert.equal(response.json.modelCalled, true);
    assert.equal(response.json.report.overallVerdict, "PASS");
    assert.equal(response.json.report.inferenceRequestId, "chatcmpl-mock-evaluation");
    assert.equal(response.json.report.modelId, "glm-5.3");
    assert.equal(response.json.report.teeVerified, null);
    assert.equal(response.json.report.teeVerifiedBy, null);
    assert.equal(await mstate(), beforeState, "evaluation does not change escrow state");

    const stored = await db.evaluationReport.findUnique({ where: { id: response.json.report.id } });
    assert.equal(stored?.submissionId, (await db.submission.findFirstOrThrow({ where: { milestoneId, anchorTxHash: { not: null } } })).id);
    assert.equal(stored?.inferenceRequestId, "chatcmpl-mock-evaluation");
    assert.equal(stored?.modelId, "glm-5.3");
    const evidence = await db.proofTrackEventRecord.findFirst({
      where: { projectId, ecosystem: "ZERO_G", referenceValue: "chatcmpl-mock-evaluation" },
    });
    assert.deepEqual([evidence?.referenceType, evidence?.verificationStatus], ["INFERENCE_REQUEST_ID", "PENDING"]);

    const repeated = await call("m_evaluate", { cookie: cookieClient, params: { id: projectId, milestoneId }, body: { aiConsent: true } });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.json.reused, true);
    assert.equal(await db.evaluationReport.count({ where: { submissionId: stored!.submissionId, inferenceRequestId: "chatcmpl-mock-evaluation" } }), 1);
  } finally {
    if (saved.apiKey === undefined) delete process.env.ZG_ROUTER_API_KEY; else process.env.ZG_ROUTER_API_KEY = saved.apiKey;
    if (saved.baseUrl === undefined) delete process.env.ZG_ROUTER_BASE_URL; else process.env.ZG_ROUTER_BASE_URL = saved.baseUrl;
    if (saved.model === undefined) delete process.env.ZG_ROUTER_MODEL; else process.env.ZG_ROUTER_MODEL = saved.model;
    if (saved.trustMode === undefined) delete process.env.ZG_ROUTER_TRUST_MODE; else process.env.ZG_ROUTER_TRUST_MODE = saved.trustMode;
    globalThis.fetch = saved.fetch;
  }
});

test("public ProofTrack route is read-only, wallet-free, evidence-complete and privacy-filtered", async () => {
  const txId = "0.0.7@1700000000.000000000";
  const payment = await db.agentPayment.create({ data: {
    idempotencyKey: "public-prooftrack-mock-payment", requestedByAddress: client.address.toLowerCase(), payerAccount: "0.0.7", projectId,
    serviceName: "TRUSTORA Security Scan", providerAccount: "0.0.482910", amountTinybars: "10000000", txId, status: "VERIFIED",
    policyDecision: "MIRROR_NODE_VERIFIED", serviceResultJson: JSON.stringify({ filesScanned: 1, findings: [{ file: "private/path.ts" }], summary: { high: 1, medium: 2 } }),
  } });
  try {
    const projectResponse = await routes.publicProof.GET(new Request(`http://${HOST}/api/public/prooftrack?project=${encodeURIComponent(projectId)}`));
    assert.equal(projectResponse.status, 200);
    const projectBody = await projectResponse.json();
    const bundle = projectBody.projects[0];
    assert.ok(bundle.evidence.arc.some((e: any) => e.verificationStatus === "VERIFIED"));
    assert.ok(bundle.evidence.zeroG.some((e: any) => e.requestId === "chatcmpl-mock-evaluation" && e.status === "PENDING"));
    assert.equal(bundle.evidence.hedera[0].verificationStatus, "VERIFIED");
    assert.equal(bundle.evidence.hedera[0].scan.high, 1);
    const publicJson = JSON.stringify(projectBody);
    assert.equal(publicJson.includes(client.address.toLowerCase()), false);
    assert.equal(publicJson.includes("private/path.ts"), false);
    assert.equal(publicJson.includes("description"), false);

    const txResponse = await routes.publicProof.GET(new Request(`http://${HOST}/api/public/prooftrack?transaction=${encodeURIComponent(txId)}`));
    assert.equal(txResponse.status, 200);
    assert.equal((await txResponse.json()).projects[0].project.id, projectId);
    const invalid = await routes.publicProof.GET(new Request(`http://${HOST}/api/public/prooftrack?transaction=${encodeURIComponent("not-a-transaction")}`));
    assert.equal(invalid.status, 400);
    const invalidProject = await routes.publicProof.GET(new Request(`http://${HOST}/api/public/prooftrack?project=${encodeURIComponent("private-project-id")}`));
    assert.equal(invalidProject.status, 400);
    const noKind = await routes.publicProof.GET(new Request(`http://${HOST}/api/public/prooftrack`));
    assert.equal(noKind.status, 400);
    const arcTx = (await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { registerTxHash: true } })).registerTxHash!;
    const arcLookup = await routes.publicProof.GET(new Request(`http://${HOST}/api/public/prooftrack?transaction=${encodeURIComponent(arcTx)}`));
    assert.equal(arcLookup.status, 200);
    const unpublishedId = "TRU-PROJ-2026-9999998";
    await db.project.create({ data: { id: unpublishedId, title: "Private", description: "Secret description", clientAddress: client.address, budgetUsdc: "1" } });
    const unpublished = await routes.publicProof.GET(new Request(`http://${HOST}/api/public/prooftrack?project=${unpublishedId}`));
    assert.equal(unpublished.status, 404);
    await db.project.delete({ where: { id: unpublishedId } });
  } finally { await db.agentPayment.delete({ where: { id: payment.id } }); }
});

test("revision then resubmit, then dispute and refund paths are role- and chain-gated", async () => {
  const pid = projectIdToBytes32(projectId);
  const revision = evt("RevisionRequested", { projectId: pid, milestoneId: 1n, client: client.address }, [{ type: "string" }], ["fix"]);
  chain.milestone.state = 3;
  assert.equal((await syncCall("revision", cookieFreelancer, mine(client.address, revision))).status, 403);
  assert.equal((await syncCall("revision", cookieClient, mine(client.address, revision))).status, 200);
  assert.equal(await mstate(), "REVISION_REQUESTED");

  // back to SUBMITTED (a legal contract transition), then refund by the freelancer is allowed; client cannot refund
  const submitted = evt("MilestoneSubmitted", { projectId: pid, milestoneId: 1n, freelancer: freelancer.address }, [{ type: "bytes32" }, { type: "string" }, { type: "uint64" }], [chain.milestone.deliverableHash, "ipfs://real-cid", 2n]);
  chain.milestone.state = 2;
  const sub = await db.submission.findFirstOrThrow({ where: { milestoneId } });
  assert.equal((await call("m_submit", { cookie: cookieFreelancer, params: { id: projectId, milestoneId }, body: { txHash: mine(freelancer.address, submitted), submissionId: sub.id } })).status, 200);
  assert.equal(await mstate(), "SUBMITTED");

  const disputed = evt("MilestoneDisputed", { projectId: pid, milestoneId: 1n, initiator: freelancer.address }, [{ type: "string" }, { type: "uint64" }], ["unfair", 3n]);
  chain.milestone.state = 6;
  assert.equal((await syncCall("dispute", cookieStranger, mine(freelancer.address, disputed))).status, 404);
  assert.equal((await syncCall("dispute", cookieFreelancer, mine(freelancer.address, disputed))).status, 200);
  assert.equal(await mstate(), "DISPUTED");
  assert.equal(await pstatus(), "DISPUTED");

  // A regression is impossible: chain says Funded but DB is DISPUTED.
  chain.milestone.state = 1;
  const funded = evt("MilestoneFunded", { projectId: pid, milestoneId: 1n, client: client.address }, [{ type: "uint256" }, { type: "uint64" }], [toUsdcBaseUnits(250), 9n]);
  const reg = await syncCall("fund", cookieClient, mine(client.address, funded));
  assert.equal(reg.json.code, "INVALID_TRANSITION");
  assert.equal(await mstate(), "DISPUTED");

  // arbiter resolves with a full refund to the client
  const refunded = evt("MilestoneRefunded", { projectId: pid, milestoneId: 1n, client: client.address }, [{ type: "uint256" }, { type: "uint64" }], [toUsdcBaseUnits(250), 4n]);
  chain.milestone.state = 7;
  assert.equal((await syncCall("refund", cookieClient, mine(client.address, refunded))).status, 403); // client is not the refunding party
  assert.equal((await syncCall("refund", cookieFreelancer, mine(freelancer.address, refunded))).status, 200);
  assert.equal(await mstate(), "REFUNDED");
  assert.equal(await pstatus(), "COMPLETED");
});

test("release is client-authorized only and needs the contract to say Released", async () => {
  // fresh project for the happy-path release
  const body = { title: "Release flow", description: "Another escrow project", freelancerAddress: freelancer.address, budgetUsdc: "50" };
  const created = await call("projects", { cookie: cookieClient, body });
  const id = created.json.project.id as string;
  const mid = created.json.project.milestones[0].id as string;
  const hash = created.json.project.milestones[0].criteriaHash as string;
  const pid = projectIdToBytes32(id);
  const msg = buildAgreementMessage({ projectId: id, versionNumber: 1, criteriaHash: hash, role: "FREELANCER" });
  assert.equal((await call("accept", { cookie: cookieFreelancer, params: { id }, body: { signature: await freelancer.signMessage({ message: msg }) } })).status, 200);
  const proj = mine(client.address, evt("ProjectCreated", { projectId: pid, client: client.address, freelancer: freelancer.address }, [{ type: "address" }, { type: "uint64" }], [ARBITER_OWNER, 1n]));
  assert.equal((await call("register", { cookie: cookieClient, params: { id }, body: { txHash: proj } })).status, 200);
  chain.milestone = { criteriaHash: "0x" + hash, amount: toUsdcBaseUnits(50), state: 0, deliverableHash: "0x" + "0".repeat(64), deliverableUri: "" };
  const add = mine(client.address, evt("MilestoneAdded", { projectId: pid, milestoneId: 1n }, [{ type: "bytes32" }, { type: "uint256" }], ["0x" + hash, toUsdcBaseUnits(50)]));
  assert.equal((await call("m_register", { cookie: cookieClient, params: { id, milestoneId: mid }, body: { txHash: add } })).status, 200);

  const sync = (action: string, who: string, tx: string) => call(`m_${action}`, { cookie: who, params: { id, milestoneId: mid }, body: { txHash: tx } });
  chain.milestone.state = 1;
  assert.equal((await sync("fund", cookieClient, mine(client.address, evt("MilestoneFunded", { projectId: pid, milestoneId: 1n, client: client.address }, [{ type: "uint256" }, { type: "uint64" }], [toUsdcBaseUnits(50), 1n])))).status, 200);

  const released = evt("MilestoneReleased", { projectId: pid, milestoneId: 1n, freelancer: freelancer.address }, [{ type: "uint256" }, { type: "uint64" }], [toUsdcBaseUnits(50), 2n]);
  const releaseTx = mine(client.address, released);
  chain.milestone.state = 1; // the contract did NOT release
  assert.equal((await sync("release", cookieClient, releaseTx)).json.code, "CHAIN_STATE_BEHIND");
  assert.equal((await db.milestone.findUniqueOrThrow({ where: { id: mid } })).state, "FUNDED");
  chain.milestone.state = 5;
  assert.equal((await sync("release", cookieFreelancer, releaseTx)).status, 403); // freelancer cannot trigger release sync
  assert.equal((await sync("release", cookieClient, mine(freelancer.address, released))).json.code, "SENDER_NOT_AUTHORIZED"); // tx not sent by the on-chain client
  const ok = await sync("release", cookieClient, releaseTx);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.projectCompleted, true);
  const m = await db.milestone.findUniqueOrThrow({ where: { id: mid } });
  assert.deepEqual([m.state, m.releaseTxHash], ["RELEASED", releaseTx]);
});
