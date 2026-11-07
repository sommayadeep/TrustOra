/**
 * @file keys.ts
 * @description Account-type-aware Hedera private key parsing. Fails closed.
 *
 * Three real hazards motivate every line here:
 *
 *  1. `PrivateKey.fromString()` silently parses a bare 32-byte hex string as ED25519, even when the
 *     account is ECDSA secp256k1. The resulting key pair is simply a different one, so signatures are
 *     rejected with no clue why. This module never calls `fromString`.
 *  2. `PrivateKey.fromStringDer()` accepts a DER-encoded ECDSA *public* key without complaint and
 *     returns a secp256k1 "private" key. A public key pasted from the Hedera portal therefore parses.
 *     Public-key DER prefixes are rejected before any SDK call touches the value.
 *  3. A bare 32-byte hex string is a valid private key for BOTH algorithms, so the algorithm cannot be
 *     inferred from the string alone. Callers that know the account type pass `expectedType`, and a
 *     mismatch is an error rather than a silently wrong key.
 *
 * No error message, and no return value, ever contains key material.
 */
import { PrivateKey } from "@x402/hedera";

export type HederaKeyType = "ED25519" | "ECDSA_SECP256K1";

export type HederaKeyErrorCode =
  | "MISSING"
  | "PUBLIC_KEY_SUPPLIED"
  | "UNSUPPORTED_ENCODING"
  | "UNKNOWN_KEY_TYPE"
  | "KEY_TYPE_MISMATCH"
  | "PARSE_FAILED";

/** Carries a machine-readable code and a human explanation. Never the value it rejected. */
export class HederaKeyError extends Error {
  constructor(readonly code: HederaKeyErrorCode, detail: string) {
    // The legacy prefix is preserved so existing callers matching on it keep working.
    super(`INVALID_HEDERA_PRIVATE_KEY_FORMAT: ${code} - ${detail}`);
    this.name = "HederaKeyError";
  }
}

/** DER prefixes, lower-case hex, no 0x. Private and public forms are deliberately distinguished. */
export const ED25519_PRIVATE_DER_PREFIX = "302e020100300506032b657004220420";
export const ECDSA_PRIVATE_DER_PREFIX = "3030020100300706052b8104000a0422";
export const ED25519_PUBLIC_DER_PREFIX = "302a300506032b6570032100";
export const ECDSA_PUBLIC_DER_PREFIX = "302d300706052b8104000a032200";

/** Accepts the spellings people actually write, including the Mirror Node's own `key._type`. */
export function normalizeHederaKeyType(value: string | undefined | null): HederaKeyType | undefined {
  const raw = (value ?? "").trim();
  if (raw === "") return undefined;
  const flat = raw.toUpperCase().replace(/[\s_-]/g, "");
  if (flat === "ED25519") return "ED25519";
  if (flat === "ECDSA" || flat === "ECDSASECP256K1" || flat === "SECP256K1") return "ECDSA_SECP256K1";
  throw new HederaKeyError("UNKNOWN_KEY_TYPE", `"${raw}" is not ED25519 or ECDSA_SECP256K1`);
}

/** The algorithm of a parsed key, normalised to the Mirror Node's vocabulary. */
export function hederaKeyTypeOf(key: PrivateKey): HederaKeyType {
  return /secp256k1/i.test(key.type) ? "ECDSA_SECP256K1" : "ED25519";
}

/**
 * The public key this private key controls, as lower-case raw hex: 32 bytes for ED25519, 33 for a
 * compressed secp256k1 point. This is the exact form the Mirror Node publishes in `key.key`, so it
 * can be compared directly. A public key is not secret.
 */
export function derivedPublicKeyRaw(key: PrivateKey): string {
  return key.publicKey.toStringRaw().toLowerCase();
}

/**
 * Parses a Hedera private key, refusing anything it cannot positively identify.
 *
 * Accepted: DER-encoded private keys (self-describing), and bare 32-byte hex. For bare hex the
 * algorithm comes from `expectedType` when supplied; otherwise the long-standing convention is used
 * (`0x`-prefixed means ECDSA, as EVM tooling writes it; bare means ED25519). Supplying `expectedType`
 * is strongly preferred: it turns a wrong-algorithm key into an error instead of a bad signature.
 */
export function parseHederaPrivateKey(
  text: string,
  opts: { expectedType?: HederaKeyType | undefined } = {},
): PrivateKey {
  const value = (typeof text === "string" ? text : "").trim();
  if (value === "") throw new HederaKeyError("MISSING", "no key was configured");

  const had0x = /^0x/i.test(value);
  const hex = (had0x ? value.slice(2) : value).toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new HederaKeyError("UNSUPPORTED_ENCODING", "expected hex, optionally 0x-prefixed");
  }

  // Hazard 2. This runs before the SDK sees the value, because the SDK would accept an ECDSA
  // public key here and hand back an unusable "private" key.
  if (hex.startsWith(ED25519_PUBLIC_DER_PREFIX) || hex.startsWith(ECDSA_PUBLIC_DER_PREFIX)) {
    throw new HederaKeyError(
      "PUBLIC_KEY_SUPPLIED",
      "this is a DER-encoded PUBLIC key; supply the account's PRIVATE key instead",
    );
  }

  const isPrivateDer =
    hex.startsWith(ED25519_PRIVATE_DER_PREFIX) ||
    hex.startsWith(ECDSA_PRIVATE_DER_PREFIX) ||
    (hex.length !== 64 && PrivateKey.isDerKey(hex));

  let key: PrivateKey;
  try {
    if (isPrivateDer) {
      key = PrivateKey.fromStringDer(hex);
    } else if (hex.length === 64) {
      // Hazard 3: 32 bytes is a valid scalar for both algorithms, so this is a decision, not a guess.
      const assumed: HederaKeyType = opts.expectedType ?? (had0x ? "ECDSA_SECP256K1" : "ED25519");
      key = assumed === "ECDSA_SECP256K1"
        ? PrivateKey.fromStringECDSA(hex)
        : PrivateKey.fromStringED25519(hex);
    } else {
      throw new HederaKeyError(
        "UNSUPPORTED_ENCODING",
        `a ${hex.length / 2}-byte value is not a Hedera private key (expected 32 bytes raw, or DER)`,
      );
    }
  } catch (err) {
    if (err instanceof HederaKeyError) throw err;
    // The SDK's message can quote the input, so it is deliberately not propagated.
    throw new HederaKeyError("PARSE_FAILED", "the Hedera SDK could not read this as a private key");
  }

  const actual = hederaKeyTypeOf(key);
  if (opts.expectedType && actual !== opts.expectedType) {
    throw new HederaKeyError(
      "KEY_TYPE_MISMATCH",
      `the key is ${actual} but the account requires ${opts.expectedType}`,
    );
  }
  return key;
}

export interface HederaKeyInspection {
  ok: boolean;
  /** Present only when parsing succeeded. */
  keyType?: HederaKeyType;
  /** Lower-case raw hex public key. Public material only. */
  publicKeyRaw?: string;
  code?: HederaKeyErrorCode;
  detail?: string;
}

/**
 * Parses without throwing, for reporting. Returns the algorithm and the derived PUBLIC key only;
 * the private value never leaves this function.
 */
export function inspectHederaPrivateKey(
  text: string | undefined,
  opts: { expectedType?: HederaKeyType | undefined } = {},
): HederaKeyInspection {
  try {
    const key = parseHederaPrivateKey(text ?? "", opts);
    return { ok: true, keyType: hederaKeyTypeOf(key), publicKeyRaw: derivedPublicKeyRaw(key) };
  } catch (err) {
    if (err instanceof HederaKeyError) return { ok: false, code: err.code, detail: err.message };
    return { ok: false, code: "PARSE_FAILED", detail: "the key could not be parsed" };
  }
}
