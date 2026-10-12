import type {
  LifecycleIdAllocatorV1,
  LifecycleInstallNonceV1,
} from "../manifest/bootstrap.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import {
  parseLowerHexSha256,
  parseUInt64Decimal,
  type UtcTimestampV1,
} from "../update/scalars.js";
import { decodeCanonicalJson, encodeCanonicalJson, type CanonicalJsonV1 } from "./canonical-json.js";

export interface UninstallingMarkerV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly createdAt: UtcTimestampV1;
}

export const NONCE_LEAF = "lifecycle-install-nonce";
export const ALLOCATOR_LEAF = "lifecycle-id-allocator.json";
export const NONCE_FILE_BYTES = 65;
const NONCE_HEX_BYTES = 64;
const LF = 0x0a;
export const MAX_ALLOCATOR_BYTES = 1_024;

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function exact(
  value: unknown,
  keys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) {
    fail(`${label}: keys`);
  }
  return input;
}

export function parseLifecycleInstallNonce(bytes: Uint8Array): LifecycleInstallNonceV1 {
  if (bytes.byteLength !== NONCE_FILE_BYTES || bytes[NONCE_HEX_BYTES] !== LF) {
    fail("LifecycleInstallNonceV1: bytes");
  }
  let text: string;
  try {
    text = decoder.decode(bytes.subarray(0, NONCE_HEX_BYTES));
  } catch {
    fail("LifecycleInstallNonceV1: encoding");
  }
  return parseLowerHexSha256(text);
}

/**
 * §2.1: the allocator's `installNonce` must equal the 64 bytes in
 * `state/lifecycle-install-nonce`, and disagreement between the two is recovery-required.
 * The nonce is a required parameter so no caller can read the allocator without it.
 */
export function parseLifecycleIdAllocator(
  bytes: Uint8Array,
  nonce: LifecycleInstallNonceV1,
): LifecycleIdAllocatorV1 {
  const input = exact(
    decodeCanonicalJson(bytes, MAX_ALLOCATOR_BYTES),
    ["installNonce", "nextCounter", "schemaVersion"],
    "LifecycleIdAllocatorV1",
  );
  if (input.schemaVersion !== 1) fail("LifecycleIdAllocatorV1: schemaVersion");
  const installNonce = parseLowerHexSha256(input.installNonce);
  if (installNonce !== nonce) fail("LifecycleIdAllocatorV1: installNonce");
  return { schemaVersion: 1, installNonce, nextCounter: parseUInt64Decimal(input.nextCounter) };
}

export function encodeLifecycleIdAllocator(value: LifecycleIdAllocatorV1): CanonicalJsonV1 {
  return encodeCanonicalJson({
    schemaVersion: value.schemaVersion,
    installNonce: value.installNonce,
    nextCounter: value.nextCounter,
  });
}

export function encodeUninstallingMarker(value: UninstallingMarkerV1): CanonicalJsonV1 {
  return encodeCanonicalJson({
    schemaVersion: value.schemaVersion,
    coordinatorId: value.coordinatorId,
    createdAt: value.createdAt,
  });
}
