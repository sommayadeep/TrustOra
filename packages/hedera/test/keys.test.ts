/**
 * Key-parsing tests. Every value here is fabricated or publicly known test material; none is a
 * credential of this project. No test prints key material.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PrivateKey } from "@x402/hedera";
import {
  ECDSA_PUBLIC_DER_PREFIX,
  ED25519_PUBLIC_DER_PREFIX,
  HederaKeyError,
  derivedPublicKeyRaw,
  hederaKeyTypeOf,
  inspectHederaPrivateKey,
  normalizeHederaKeyType,
  parseHederaPrivateKey,
} from "../src/keys";

/** Publicly-known Hardhat test scalar. Valid for both algorithms, which is the whole problem. */
const RAW = "4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";
const SENTINEL = "NEVER-EMIT-THIS-SENTINEL-KEY-0000";

const fails = (fn: () => unknown, code: string) => {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof HederaKeyError, `expected HederaKeyError, got ${String(err)}`);
    assert.equal(err.code, code);
    assert.match(err.message, /INVALID_HEDERA_PRIVATE_KEY_FORMAT/);
    return true;
  });
};

test("ED25519 keys parse correctly, as bare hex and as DER", () => {
  const bare = parseHederaPrivateKey(RAW, { expectedType: "ED25519" });
  assert.equal(hederaKeyTypeOf(bare), "ED25519");
  assert.equal(derivedPublicKeyRaw(bare).length, 64, "ED25519 public keys are 32 bytes");

  const der = PrivateKey.fromStringED25519(RAW).toStringDer();
  const fromDer = parseHederaPrivateKey(der);
  assert.equal(hederaKeyTypeOf(fromDer), "ED25519");
  assert.equal(derivedPublicKeyRaw(fromDer), derivedPublicKeyRaw(bare), "same key either way");
});

test("ECDSA secp256k1 keys parse correctly, as 0x hex and as DER", () => {
  const hex = parseHederaPrivateKey(`0x${RAW}`, { expectedType: "ECDSA_SECP256K1" });
  assert.equal(hederaKeyTypeOf(hex), "ECDSA_SECP256K1");
  assert.equal(derivedPublicKeyRaw(hex).length, 66, "compressed secp256k1 points are 33 bytes");

  const der = PrivateKey.fromStringECDSA(RAW).toStringDer();
  const fromDer = parseHederaPrivateKey(der);
  assert.equal(hederaKeyTypeOf(fromDer), "ECDSA_SECP256K1");
  assert.equal(derivedPublicKeyRaw(fromDer), derivedPublicKeyRaw(hex));
});

test("the same 32-byte scalar yields two different keys, so the algorithm must be chosen", () => {
  const ed = parseHederaPrivateKey(RAW, { expectedType: "ED25519" });
  const ec = parseHederaPrivateKey(RAW, { expectedType: "ECDSA_SECP256K1" });
  assert.notEqual(derivedPublicKeyRaw(ed), derivedPublicKeyRaw(ec));
});

test("an explicit expected type overrides the 0x convention and catches a wrong-algorithm key", () => {
  // A bare-hex ECDSA key is the exact trap that silently produced an unusable signer before.
  const ec = parseHederaPrivateKey(RAW, { expectedType: "ECDSA_SECP256K1" });
  assert.equal(hederaKeyTypeOf(ec), "ECDSA_SECP256K1");
  // DER is self-describing, so a declared type that contradicts it must fail rather than be ignored.
  const edDer = PrivateKey.fromStringED25519(RAW).toStringDer();
  fails(() => parseHederaPrivateKey(edDer, { expectedType: "ECDSA_SECP256K1" }), "KEY_TYPE_MISMATCH");
});

test("without an expected type, 0x means ECDSA and bare hex means ED25519", () => {
  assert.equal(hederaKeyTypeOf(parseHederaPrivateKey(`0x${RAW}`)), "ECDSA_SECP256K1");
  assert.equal(hederaKeyTypeOf(parseHederaPrivateKey(RAW)), "ED25519");
});

test("a DER-encoded PUBLIC key is never accepted as a private key", () => {
  // The SDK parses an ECDSA public DER blob as a secp256k1 PrivateKey without complaint, so this
  // guard is the only thing standing between a copy-paste slip and an unusable signer.
  const ecdsaPublicDer = PrivateKey.fromStringECDSA(RAW).publicKey.toStringDer();
  const ed25519PublicDer = PrivateKey.fromStringED25519(RAW).publicKey.toStringDer();
  assert.ok(ecdsaPublicDer.toLowerCase().startsWith(ECDSA_PUBLIC_DER_PREFIX));
  assert.ok(ed25519PublicDer.toLowerCase().startsWith(ED25519_PUBLIC_DER_PREFIX));

  // Proof the hazard is real: the raw SDK call succeeds on the ECDSA public key.
  assert.doesNotThrow(() => PrivateKey.fromStringDer(ecdsaPublicDer));

  fails(() => parseHederaPrivateKey(ecdsaPublicDer), "PUBLIC_KEY_SUPPLIED");
  fails(() => parseHederaPrivateKey(ed25519PublicDer), "PUBLIC_KEY_SUPPLIED");
  fails(() => parseHederaPrivateKey(`0x${ecdsaPublicDer}`), "PUBLIC_KEY_SUPPLIED");
  fails(() => parseHederaPrivateKey(ed25519PublicDer.toUpperCase()), "PUBLIC_KEY_SUPPLIED");
});

test("invalid key formats fail closed, and the rejected value never appears in the error", () => {
  fails(() => parseHederaPrivateKey(""), "MISSING");
  fails(() => parseHederaPrivateKey("   "), "MISSING");
  fails(() => parseHederaPrivateKey(SENTINEL), "UNSUPPORTED_ENCODING");
  fails(() => parseHederaPrivateKey("0xZZZZ"), "UNSUPPORTED_ENCODING");
  fails(() => parseHederaPrivateKey(RAW.slice(0, 63)), "UNSUPPORTED_ENCODING"); // odd length
  fails(() => parseHederaPrivateKey(RAW.slice(0, 62)), "UNSUPPORTED_ENCODING"); // 31 bytes
  fails(() => parseHederaPrivateKey(RAW + "ab"), "UNSUPPORTED_ENCODING"); // 33 bytes

  for (const bad of [SENTINEL, `0x${SENTINEL}`]) {
    try {
      parseHederaPrivateKey(bad);
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(!(err as Error).message.includes(SENTINEL), "error leaked the rejected value");
    }
  }
});

test("surrounding whitespace and case are tolerated", () => {
  assert.equal(hederaKeyTypeOf(parseHederaPrivateKey(`  0x${RAW}\n`)), "ECDSA_SECP256K1");
  assert.equal(hederaKeyTypeOf(parseHederaPrivateKey(`\t${RAW.toUpperCase()}  `)), "ED25519");
});

test("key-type names are normalised from the spellings people and the Mirror Node use", () => {
  assert.equal(normalizeHederaKeyType("ED25519"), "ED25519");
  assert.equal(normalizeHederaKeyType("ed25519"), "ED25519");
  assert.equal(normalizeHederaKeyType("ECDSA"), "ECDSA_SECP256K1");
  assert.equal(normalizeHederaKeyType("ECDSA_SECP256K1"), "ECDSA_SECP256K1");
  assert.equal(normalizeHederaKeyType("secp256k1"), "ECDSA_SECP256K1");
  assert.equal(normalizeHederaKeyType(undefined), undefined);
  assert.equal(normalizeHederaKeyType("  "), undefined);
  fails(() => normalizeHederaKeyType("rsa"), "UNKNOWN_KEY_TYPE");
});

test("derived public keys are the exact form the Mirror Node publishes", () => {
  // Mirror Node reports `key.key` as raw lower-case hex with no 0x and no DER wrapper, which is what
  // the preflight compares against. Pinning the shape here keeps that comparison meaningful.
  for (const type of ["ED25519", "ECDSA_SECP256K1"] as const) {
    const pub = derivedPublicKeyRaw(parseHederaPrivateKey(RAW, { expectedType: type }));
    assert.match(pub, /^[0-9a-f]+$/, "lower-case hex, no 0x");
    assert.equal(pub, pub.toLowerCase());
    assert.equal(pub.length, type === "ED25519" ? 64 : 66);
  }
});

test("inspect reports type and public key without throwing, and never the private value", () => {
  const good = inspectHederaPrivateKey(`0x${RAW}`, { expectedType: "ECDSA_SECP256K1" });
  assert.equal(good.ok, true);
  assert.equal(good.keyType, "ECDSA_SECP256K1");
  assert.match(good.publicKeyRaw!, /^[0-9a-f]{66}$/);
  assert.doesNotMatch(JSON.stringify(good), new RegExp(RAW, "i"), "the private scalar leaked");

  const bad = inspectHederaPrivateKey(SENTINEL);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "UNSUPPORTED_ENCODING");
  assert.ok(!JSON.stringify(bad).includes(SENTINEL));

  const absent = inspectHederaPrivateKey(undefined);
  assert.equal(absent.ok, false);
  assert.equal(absent.code, "MISSING");
});
