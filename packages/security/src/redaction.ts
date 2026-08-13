import { createHmac } from "node:crypto";

export interface RedactionFinding {
  readonly class: string;
  readonly fingerprint: string;
}

export interface RedactionResult {
  readonly text: string;
  readonly findings: readonly RedactionFinding[];
}

/**
 * `userPatterns` is the only caller-supplied redaction input, so it is kept
 * to literal substrings rather than regular expressions — a compiled
 * expression over capture text is a ReDoS surface, and this codebase bounds
 * no expression anywhere. Optional so the two existing call sites, which
 * pass no third argument, keep compiling and behaving unchanged.
 */
export interface RedactionOptions {
  readonly userPatterns?: readonly string[];
}

/**
 * Declaration order is the contract a consumer can rely on to enumerate
 * every class a redaction can emit; a test asserts membership against
 * findings actually produced, not against this list, so a tenth class
 * cannot be added here without also being reachable.
 */
export const REDACTION_CLASSES = Object.freeze([
  "private-key",
  "env-secret",
  "bearer-token",
  "provider-token",
  "certificate",
  "credential-store",
  "service-credential",
  "high-entropy",
  "user-pattern",
] as const);

interface RedactionCandidate {
  readonly start: number;
  readonly end: number;
  readonly class: string;
  readonly secret: string;
}

function overlaps(
  left: RedactionCandidate,
  right: RedactionCandidate,
): boolean {
  return left.start < right.end && right.start < left.end;
}

function addCandidate(
  candidates: RedactionCandidate[],
  candidate: RedactionCandidate,
): void {
  if (
    candidate.secret.length === 0 ||
    candidates.some((existing) => overlaps(existing, candidate))
  ) {
    return;
  }
  candidates.push(candidate);
}

function addWholeMatches(
  text: string,
  expression: RegExp,
  findingClass: string,
  candidates: RedactionCandidate[],
): void {
  for (const match of text.matchAll(expression)) {
    const secret = match[0];
    addCandidate(candidates, {
      start: match.index,
      end: match.index + secret.length,
      class: findingClass,
      secret,
    });
  }
}

function addCapturedMatches(
  text: string,
  expression: RegExp,
  findingClass: string,
  captureIndex: number,
  candidates: RedactionCandidate[],
): void {
  for (const match of text.matchAll(expression)) {
    const secret = match[captureIndex];
    if (secret === undefined || secret.length === 0) {
      continue;
    }
    const offsetWithinMatch = match[0].lastIndexOf(secret);
    if (offsetWithinMatch < 0) {
      continue;
    }
    const start = match.index + offsetWithinMatch;
    addCandidate(candidates, {
      start,
      end: start + secret.length,
      class: findingClass,
      secret,
    });
  }
}

/**
 * `text.slice(...).toLowerCase()` on a window rather than `toLowerCase()`
 * over the whole haystack up front: for a handful of code points (U+0130 is
 * the documented case) lower-casing lengthens the string, and a global
 * lower-cased haystack would shift every index after the first such
 * character out from under the original `text` it is sliced against. A
 * per-window fold never accumulates that drift — a missed match here fails
 * safe, a shifted offset would redact the wrong bytes.
 */
function matchesCaseInsensitively(
  text: string,
  start: number,
  needle: string,
): boolean {
  return text.slice(start, start + needle.length).toLowerCase() === needle;
}

/**
 * `indexOf` semantics, never `RegExp` — spec §8.2, narrowed from design spec
 * §14.3's "user-configured patterns" because a user-supplied expression over
 * capture text is an unbounded ReDoS surface and `capture` is the one
 * operation that must not hang. See `BACKLOG.md` §8 for the ratified
 * narrowing.
 */
function addUserPatterns(
  text: string,
  patterns: readonly string[],
  candidates: RedactionCandidate[],
): void {
  const normalized = text.normalize("NFC");
  for (const pattern of patterns) {
    const needle = pattern.normalize("NFC").toLowerCase();
    if (needle.length === 0) continue;
    for (
      let start = 0;
      start <= normalized.length - needle.length;
      start += 1
    ) {
      if (!matchesCaseInsensitively(normalized, start, needle)) continue;
      addCandidate(candidates, {
        start,
        end: start + needle.length,
        class: "user-pattern",
        secret: text.slice(start, start + needle.length),
      });
    }
  }
}

function shannonEntropy(value: string): number {
  const frequencies = new Map<string, number>();
  for (const character of value) {
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }

  let entropy = 0;
  for (const frequency of frequencies.values()) {
    const probability = frequency / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function detectedAlphabetSize(value: string): number {
  let alphabetSize = 0;
  if (/[a-z]/u.test(value)) {
    alphabetSize += 26;
  }
  if (/[A-Z]/u.test(value)) {
    alphabetSize += 26;
  }
  if (/[0-9]/u.test(value)) {
    alphabetSize += 10;
  }
  if (/[+/=]/u.test(value)) {
    alphabetSize += 3;
  }
  if (/[_-]/u.test(value)) {
    alphabetSize += 2;
  }
  return alphabetSize;
}

function looksHighEntropy(value: string): boolean {
  if (value.length < 40) {
    return false;
  }

  const entropy = shannonEntropy(value);
  const isCommonLowercaseHexEncoding =
    (value.length === 64 || value.length === 96 || value.length === 128) &&
    /^[a-f0-9]+$/u.test(value);
  if (isCommonLowercaseHexEncoding) {
    return entropy >= 3.5;
  }

  const isLowercaseAlphanumeric =
    /^[a-z0-9]+$/u.test(value) &&
    /[a-z]/u.test(value) &&
    /[0-9]/u.test(value);
  const alphabetSize = detectedAlphabetSize(value);
  if (alphabetSize < 2) {
    return false;
  }

  const normalizedEntropy = entropy / Math.log2(alphabetSize);
  if (isLowercaseAlphanumeric) {
    return entropy >= 4 && normalizedEntropy >= 0.72;
  }

  return entropy >= 4 && normalizedEntropy >= 0.7;
}

function fingerprint(secret: string, key: Uint8Array): string {
  return createHmac("sha256", key)
    .update(secret)
    .digest("hex")
    .slice(0, 16);
}

export function redactText(
  text: string,
  key: Uint8Array,
  options: RedactionOptions = {},
): RedactionResult {
  if (key.byteLength < 32) {
    throw new RangeError("Redaction key must contain at least 32 bytes");
  }

  const candidates: RedactionCandidate[] = [];

  addWholeMatches(
    text,
    /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/gu,
    "private-key",
    candidates,
  );
  addCapturedMatches(
    text,
    /(?:^|[\r\n])\s*[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Za-z0-9_]*\s*=\s*([^\r\n]+)/gu,
    "env-secret",
    1,
    candidates,
  );
  addCapturedMatches(
    text,
    /Authorization\s*:\s*Bearer\s+([A-Za-z0-9._~+/=-]+)/giu,
    "bearer-token",
    1,
    candidates,
  );
  addWholeMatches(
    text,
    /(?:ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,})/gu,
    "provider-token",
    candidates,
  );
  addWholeMatches(
    text,
    /-----BEGIN (?:[A-Z0-9]+ )?CERTIFICATE-----[\s\S]*?-----END (?:[A-Z0-9]+ )?CERTIFICATE-----/gu,
    "certificate",
    candidates,
  );
  /**
   * `~/.aws/credentials`, `.netrc` and `.npmrc` value shapes. The two calls
   * are separate because the formats disagree on separator: ini-style
   * `key = value`/`key=value` for the AWS and npm files, space-separated
   * `password <value>` for `.netrc` — one capture group cannot express both.
   */
  addCapturedMatches(
    text,
    /(?:aws_secret_access_key|aws_session_token|_authToken|_auth|_password)\s*[:=]\s*(\S+)/giu,
    "credential-store",
    1,
    candidates,
  );
  addCapturedMatches(
    text,
    /\bpassword\s+(\S{3,})/giu,
    "credential-store",
    1,
    candidates,
  );
  addWholeMatches(
    text,
    /(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|(?:sk|rk)_live_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu,
    "service-credential",
    candidates,
  );
  addUserPatterns(text, options.userPatterns ?? [], candidates);

  for (const match of text.matchAll(/[A-Za-z0-9+/=_-]{40,}/gu)) {
    if (!looksHighEntropy(match[0])) {
      continue;
    }
    addCandidate(candidates, {
      start: match.index,
      end: match.index + match[0].length,
      class: "high-entropy",
      secret: match[0],
    });
  }

  candidates.sort((left, right) => left.start - right.start);

  let cursor = 0;
  let redacted = "";
  const findings: RedactionFinding[] = [];
  for (const candidate of candidates) {
    redacted += text.slice(cursor, candidate.start);
    redacted += `[REDACTED:${candidate.class}]`;
    findings.push({
      class: candidate.class,
      fingerprint: fingerprint(candidate.secret, key),
    });
    cursor = candidate.end;
  }
  redacted += text.slice(cursor);

  return { text: redacted, findings };
}
