declare const stableSemverV1: unique symbol;
declare const uint64DecimalV1: unique symbol;
declare const positiveUInt32V1: unique symbol;
declare const lowerHexSha256: unique symbol;
declare const utcTimestampV1: unique symbol;
declare const lowercaseKebabIdV1: unique symbol;
declare const safeReasonCodeV1: unique symbol;
declare const tenDigitZeroPaddedOrdinalV1: unique symbol;

export type StableSemverV1 = string & { readonly [stableSemverV1]: true };
export type UInt64DecimalV1 = string & { readonly [uint64DecimalV1]: true };
export type PositiveUInt32V1 = number & { readonly [positiveUInt32V1]: true };
export type LowerHexSha256 = string & { readonly [lowerHexSha256]: true };
export type UtcTimestampV1 = string & { readonly [utcTimestampV1]: true };
export type LowercaseKebabIdV1 = string & { readonly [lowercaseKebabIdV1]: true };
export type SafeReasonCodeV1 = string & { readonly [safeReasonCodeV1]: true };
export type SchemaMigrationIdV1 = `migration_${LowercaseKebabIdV1}`;
export type TenDigitZeroPaddedOrdinalV1 = string & { readonly [tenDigitZeroPaddedOrdinalV1]: true };

const maximumUInt32 = 4_294_967_295;
const maximumUInt64 = 18_446_744_073_709_551_615n;
const maximumOrdinal = 9_999_999_999;
const encoder = new TextEncoder();

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

export function parseStableSemver(value: unknown): StableSemverV1 {
  const text = requireString(value, "StableSemverV1");
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(text);
  if (match === null || match.slice(1).some((component) => Number(component) > maximumUInt32)) {
    throw new Error("invalid StableSemverV1");
  }
  return text as StableSemverV1;
}

export function parseUInt64Decimal(value: unknown): UInt64DecimalV1 {
  const text = requireString(value, "UInt64DecimalV1");
  if (!/^(?:0|[1-9][0-9]*)$/.test(text) || BigInt(text) > maximumUInt64) throw new Error("invalid UInt64DecimalV1");
  return text as UInt64DecimalV1;
}

export function parsePositiveUInt32(value: unknown): PositiveUInt32V1 {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximumUInt32) {
    throw new Error("invalid PositiveUInt32V1");
  }
  return value as PositiveUInt32V1;
}

export function parseLowerHexSha256(value: unknown): LowerHexSha256 {
  const text = requireString(value, "LowerHexSha256");
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Error("invalid LowerHexSha256");
  return text as LowerHexSha256;
}

export function parseUtcTimestamp(value: unknown): UtcTimestampV1 {
  const text = requireString(value, "UtcTimestampV1");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)) throw new Error("invalid UtcTimestampV1");
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) throw new Error("invalid UtcTimestampV1");
  return text as UtcTimestampV1;
}

export function parseLowercaseKebabId(value: unknown): LowercaseKebabIdV1 {
  const text = requireString(value, "LowercaseKebabIdV1");
  if (encoder.encode(text).byteLength < 1 || encoder.encode(text).byteLength > 96 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(text)) {
    throw new Error("invalid LowercaseKebabIdV1");
  }
  return text as LowercaseKebabIdV1;
}

export function parseSafeReasonCode(value: unknown): SafeReasonCodeV1 {
  const text = requireString(value, "SafeReasonCodeV1");
  if (encoder.encode(text).byteLength < 1 || encoder.encode(text).byteLength > 64 || !/^[a-z][a-z0-9_]*$/.test(text)) {
    throw new Error("invalid SafeReasonCodeV1");
  }
  return text as SafeReasonCodeV1;
}

export function parseSchemaMigrationId(value: unknown): SchemaMigrationIdV1 {
  const text = requireString(value, "SchemaMigrationIdV1");
  if (!text.startsWith("migration_")) throw new Error("invalid SchemaMigrationIdV1");
  parseLowercaseKebabId(text.slice("migration_".length));
  return text as SchemaMigrationIdV1;
}

export function decodeTenDigitOrdinal(value: unknown): number {
  const text = requireString(value, "TenDigitZeroPaddedOrdinalV1");
  if (!/^[0-9]{10}$/.test(text)) throw new Error("invalid TenDigitZeroPaddedOrdinalV1");
  const decoded = Number(text);
  if (!Number.isSafeInteger(decoded) || decoded < 0 || decoded > maximumOrdinal) throw new Error("invalid TenDigitZeroPaddedOrdinalV1");
  return decoded;
}

export function parseTenDigitZeroPaddedOrdinal(value: unknown): TenDigitZeroPaddedOrdinalV1 {
  const text = requireString(value, "TenDigitZeroPaddedOrdinalV1");
  decodeTenDigitOrdinal(text);
  return text as TenDigitZeroPaddedOrdinalV1;
}

export function encodeTenDigitOrdinal(value: number): TenDigitZeroPaddedOrdinalV1 {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximumOrdinal) throw new Error("invalid ordinal");
  return value.toString(10).padStart(10, "0") as TenDigitZeroPaddedOrdinalV1;
}
