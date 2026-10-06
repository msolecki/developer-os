import { parseLowerHexSha256, parseUtcTimestamp } from "./update/scalars.js";

/** Internal shape guards shared by the core validators; deliberately not exported from the package door. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exactly these keys, in any order: an unknown key is a shape this reader does not understand. */
export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function admits(parse: (value: unknown) => unknown, value: unknown): value is string {
  try {
    parse(value);
    return true;
  } catch {
    return false;
  }
}

export function isLowerHexSha256(value: unknown): value is string {
  return admits(parseLowerHexSha256, value);
}

/** `Date.toISOString()` output only; `Date.parse` would also admit "2026". */
export function isUtcTimestamp(value: unknown): value is string {
  return admits(parseUtcTimestamp, value);
}
