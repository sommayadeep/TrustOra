# packages/og: 0G inference adapters (M3)

Only this package knows 0G SDK/HTTP details. Everything else uses `OgChatClient`.

- `src/router.ts` PRIMARY: OpenAI-compatible 0G Private Computer Router. The verified deployment uses `https://router-api.0g.ai/v1` with `glm-5.3`; `verify_tee: true` is sent.
- `src/compute.ts` FALLBACK: compute broker SDK, lazy-loaded. Method names UNVERIFIED until a first real run.
- `src/index.ts` `createOgClientFromEnv(env)` -> `{client, path: "router"|"broker"|"none"}`.

## Rules baked into code
- A 0G request ID is an **INFERENCE_REQUEST_ID**, never a transaction hash. No explorer link.
- No request ID in the response -> `NO_REQUEST_ID` error. IDs are never invented.
- `tee_verified` from the Router is **router-reported**, not independent. Only the broker path's `processResponse` is `sdk-independent`.
- `healthCheck()` returns at most `CONFIGURED`. `CONNECTED` is earned only by a real successful inference (evaluator tracks it). Nothing here returns `VERIFIED`.
- Testnet only: mainnet router host and mainnet RPC are refused.
- Errors redact the API key.

## Real run (needs your local env; do not paste keys anywhere)
```bash
export ZG_ROUTER_API_KEY=...   # from https://pc.testnet.0g.ai -> API Keys (after depositing testnet 0G)
npx tsx packages/og/scripts/smoke.ts
```
Success writes `out/real-inference.json` with the real request ID. Failure prints `FAILED [CODE]: message` and writes nothing.

## Tests
`npx tsx --test packages/og/test/*.test.ts` uses `MOCK_` fetch/modules: it proves adapter **logic**, not that 0G works.
