/**
 * NEW-141: the ingest attempt-order record at `state/ingest-attempts.json`.
 *
 * It counts, per accepted capture, how many runs selected it and saw it refused, so selection
 * can put a capture that keeps refusing behind the ones nothing has tried yet. Without it the
 * order is `captureId` alone, and N refusing captures at the head of the list make every
 * `ingest --limit N` ingest nothing.
 *
 * It holds capture ids and counts, nothing else — no path, no message, no model output. Fresh
 * `init` reserves it as an empty file, and zero bytes is "no record". An installation made before
 * the reservation has no file, and ingest then neither reads nor writes one.
 */
import { decodeCanonicalJson, encodeCanonicalJson } from "@developer-os/core";
import type { CanonicalJsonValue } from "@developer-os/core";

export const MAX_INGEST_ATTEMPTS_BYTES = 1_048_576;

const ENCODER = new TextEncoder();

function invalid(): never {
  throw new Error("invalid ingest attempt-order record");
}

/** Zero bytes is the empty record; anything else must be the canonical encoding. */
export function parseIngestAttempts(bytes: Uint8Array): ReadonlyMap<string, number> {
  if (bytes.byteLength === 0) return new Map();
  const value = decodeCanonicalJson(bytes, MAX_INGEST_ATTEMPTS_BYTES);
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const record = value as { readonly [key: string]: CanonicalJsonValue };
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "attempts" || keys[1] !== "schemaVersion") invalid();
  if (record.schemaVersion !== 1) invalid();
  const attempts = record.attempts;
  if (typeof attempts !== "object" || attempts === null || Array.isArray(attempts)) invalid();
  const parsed = new Map<string, number>();
  for (const [id, count] of Object.entries(attempts)) {
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) invalid();
    parsed.set(id, count);
  }
  return parsed;
}

function encode(entries: readonly (readonly [string, number])[]): Uint8Array {
  if (entries.length === 0) return new Uint8Array();
  return ENCODER.encode(
    encodeCanonicalJson({ attempts: Object.fromEntries(entries), schemaVersion: 1 }),
  );
}

/**
 * The empty record encodes to zero bytes, the same shape fresh `init` reserved. A record over
 * `maximumBytes` keeps the captures with the most refusals — the ones the order must keep
 * behind — and drops the rest, which then sort as untried.
 */
export function encodeIngestAttempts(
  attempts: ReadonlyMap<string, number>,
  maximumBytes = MAX_INGEST_ATTEMPTS_BYTES,
): Uint8Array {
  let entries = [...attempts];
  let bytes = encode(entries);
  if (bytes.byteLength <= maximumBytes) return bytes;
  entries = entries.sort((left, right) => right[1] - left[1]);
  while (bytes.byteLength > maximumBytes) {
    entries = entries.slice(0, Math.floor(entries.length * 0.9));
    bytes = encode(entries);
  }
  return bytes;
}

/**
 * Fewest refused attempts first; ties keep the input order, which is `captureId` order.
 * `Array.prototype.sort` is stable, so this needs no second key.
 */
export function orderByAttempts<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  attempts: ReadonlyMap<string, number>,
): T[] {
  return [...items].sort((left, right) => (attempts.get(idOf(left)) ?? 0) - (attempts.get(idOf(right)) ?? 0));
}

/**
 * The record after one run: every capture still accepted at the start of it keeps its count,
 * plus one if this run refused it; an ingested one leaves the record, and so does any id no
 * longer accepted, which is what keeps the record bounded by the quarantine.
 */
export function nextIngestAttempts(
  previous: ReadonlyMap<string, number>,
  accepted: readonly string[],
  refused: ReadonlySet<string>,
  ingested: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const next = new Map<string, number>();
  for (const id of accepted) {
    if (ingested.has(id)) continue;
    const count = (previous.get(id) ?? 0) + (refused.has(id) ? 1 : 0);
    if (count > 0) next.set(id, count);
  }
  return next;
}
