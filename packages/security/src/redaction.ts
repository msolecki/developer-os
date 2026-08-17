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
 * A haystack folded to lower case alongside a map from every haystack code
 * unit back to the source character that produced it. `toLowerCase()`
 * expands a handful of code points (U+0130 is the documented case) into
 * more than one code unit; folding character-by-character rather than as
 * one `text.toLowerCase()` call keeps every output unit attributable to
 * exactly one source character, so a match `indexOf` finds in `haystack`
 * translates back to `text` without drift — one coordinate space, built
 * once in O(n), rather than a window re-sliced and re-folded per candidate
 * (that shape measured at 533 ms for 2 MB of text against 10 patterns; this
 * one is real `String.prototype.indexOf`, native and linear).
 */
interface FoldedHaystack {
  readonly haystack: string;
  /**
   * Keyed by haystack offset, valued by the source `text` offset where the
   * character that produced that haystack position begins. Also carries a
   * sentinel entry at `haystack.length` mapping to `text.length`, so a
   * match ending at the haystack's end still resolves.
   */
  readonly originalOffsetAt: ReadonlyMap<number, number>;
}

function buildFoldedHaystack(text: string): FoldedHaystack {
  const haystackParts: string[] = [];
  const originalOffsetAt = new Map<number, number>();
  let haystackLength = 0;
  let sourceIndex = 0;
  for (const character of text) {
    originalOffsetAt.set(haystackLength, sourceIndex);
    const folded = foldForMatching(character);
    haystackParts.push(folded);
    haystackLength += folded.length;
    sourceIndex += character.length;
  }
  originalOffsetAt.set(haystackLength, sourceIndex);
  return { haystack: haystackParts.join(""), originalOffsetAt };
}

/**
 * Rejects a haystack match whose start or end falls inside the code units
 * one source character expanded into — such a match cannot be attributed to
 * a whole number of source characters, so it is dropped rather than
 * reported at a guessed offset. A drop here is a miss, never a misplaced
 * redaction; `buildFoldedHaystack`'s sentinel entry is what lets a match
 * ending exactly at the text's end still resolve.
 */
function toOriginalRange(
  folded: FoldedHaystack,
  haystackStart: number,
  haystackLength: number,
): { readonly start: number; readonly end: number } | null {
  const start = folded.originalOffsetAt.get(haystackStart);
  const end = folded.originalOffsetAt.get(haystackStart + haystackLength);
  if (start === undefined || end === undefined) {
    return null;
  }
  return { start, end };
}

/**
 * `indexOf` semantics, never `RegExp` — spec §8.2, narrowed from design spec
 * §14.3's "user-configured patterns" because a user-supplied expression over
 * capture text is an unbounded ReDoS surface and `capture` is the one
 * operation that must not hang. See `docs/superpowers/BACKLOG.md` §8 for the
 * ratified narrowing.
 *
 * `text` is assumed already NFC-normalized by the caller (`redactText`
 * normalizes once, at the top, for every class) — folding it again here
 * would be a harmless no-op, but building the haystack from the same string
 * every other class matches against is what keeps this in the same
 * coordinate space as the rest of the function.
 */
/**
 * **One folding rule for both sides of the comparison, and the reason is a real miss.**
 * `buildFoldedHaystack` folds the text **per character**, because it has to keep a map
 * from folded offsets back to original ones. A needle folded whole-string does not agree
 * with that: JavaScript's `toLowerCase` applies Unicode's Final_Sigma conditional mapping
 * to a *string* and not to an isolated character, so `"ΟΔΟΣ"` folds to `"οδος"`
 * whole-string and `"οδοσ"` per character.
 *
 * The consequence was a **silent miss in the direction that matters**: a Greek company
 * name written in capitals — which is how it appears on a letterhead — could be
 * configured in `[redaction]` and never redacted at all, with no error and no finding.
 * Final_Sigma is the only conditional lowercase mapping `toLowerCase` applies, so this
 * was one bounded case rather than a family; `ß` and `İ` expand identically either way.
 *
 * **What this does not buy:** an accent is a different letter. A pattern typed `Οδός`
 * does not match text reading `ΟΔΟΣ`, and that is correct rather than a gap — nothing
 * here folds diacritics away, and a rule that did would match words nobody configured.
 */
function foldForMatching(value: string): string {
  let folded = "";
  /** `for…of` walks code points, matching `buildFoldedHaystack`'s own iteration. */
  for (const character of value) folded += character.toLowerCase();
  /**
   * **Then unify the two lowercase sigmas, which is what `toLowerCase` will not do.**
   * Greek writes one letter two ways depending on position, and `toLowerCase` preserves
   * that distinction — so folding consistently on both sides is necessary and not
   * sufficient. Without this line the rule merely *moves* which cases miss: `ΟΔΟΣ` from a
   * letterhead matches all-caps text and stops matching `οδος`, the way the word is
   * ordinarily written in a sentence, which is the likelier spelling in a capture.
   *
   * `ς → σ` is exactly what Unicode case folding does with this pair, it is one code unit
   * to one code unit — so `originalOffsetAt` and `toOriginalRange` are untouched, unlike
   * the `İ → i̇` expansion they already handle — and it is Greek-only in effect: no other
   * script has two lowercase forms of one letter that fold together. Hebrew's final forms
   * are distinct letters and are deliberately not folded.
   */
  return folded.replace(/ς/gu, "σ");
}

function addUserPatterns(
  text: string,
  patterns: readonly string[],
  candidates: RedactionCandidate[],
): void {
  if (patterns.length === 0) return;

  const folded = buildFoldedHaystack(text);
  /**
   * **Folded first, then de-duplicated, then sorted longest-first — in that order, and
   * the order is the whole correctness argument.**
   *
   * `addCandidate` is first-wins on overlap, so an unsorted scan makes the result depend
   * on how the user typed the table: `["Acme", "Acme Corp"]` over `"hello Acme Corp bye"`
   * redacts the short form and **leaves `Corp` in the clear**, while the reverse order
   * redacts the whole name. Listing both the short and the long form of a client name is
   * the obvious thing for a founder to do.
   *
   * **Sorting on the raw string instead of the folded one reintroduces exactly that bug,
   * deterministically.** Matching happens on `normalize("NFC").toLowerCase()`, and the
   * two lengths disagree whenever a pattern arrives decomposed — which macOS filenames,
   * Finder copy-paste and several editors all produce. A decomposed `"Nguyễn Văn Ánh"` is
   * eighteen raw units and fourteen folded ones, so it sorts *ahead* of a composed
   * `"Nguyễn Văn Ánh Co"` at seventeen, claims fourteen characters, and drops the longer
   * candidate as an overlap: `" Co"` left in the clear in **both** configured orders.
   *
   * Folding before the `Set` also makes the de-duplication mean what its name says:
   * `["Acme", "acme"]` is one needle, scanned once, where a byte-identical dedupe scanned
   * it twice.
   *
   * **What longest-first does not close: partial overlap.** Two patterns that interleave
   * rather than contain — `["Acme Corp", "Corp Holdings"]` over `"x Acme Corp Holdings y"`
   * — still cannot both win, and `"Acme"` stays in the clear. That is `addCandidate`'s
   * first-wins rule and predates this ordering; it is recorded as `BACKLOG.md` §1 **NEW-25**
   * rather than silently implied to be handled.
   */
  const ordered = [
    ...new Set(patterns.map((pattern) => foldForMatching(pattern.normalize("NFC")))),
  ].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  for (const needle of ordered) {
    if (needle.length === 0) continue;
    for (
      let at = folded.haystack.indexOf(needle);
      at >= 0;
      at = folded.haystack.indexOf(needle, at + needle.length)
    ) {
      const range = toOriginalRange(folded, at, needle.length);
      if (range === null) continue;
      addCandidate(candidates, {
        start: range.start,
        end: range.end,
        class: "user-pattern",
        secret: text.slice(range.start, range.end),
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

/**
 * A real PEM body (RSA-4096 private key, a typical certificate) is at most
 * a few KB of base64; 8,000 is generous headroom above that, not a
 * realistic ceiling. Bounding it turns a lazy `[\s\S]*?` from "rescan to
 * end-of-input on every unmatched BEGIN" — 16,000 markers measured at
 * 1.77 s, worse than linear — into "rescan at most this far", which is
 * linear in input size for a fixed bound. A first attempt at this bound
 * used 100,000, which measured *worse* (2.0 s at 16,000 markers): with no
 * `END` anywhere in that adversarial input, nearly every failed scan still
 * ran to the full bound, so a bound close to realistic PEM sizes — not
 * merely finite — is what actually caps the cost; 8,000 measured 175 ms
 * for the same input.
 */
const MAX_PEM_BODY_LENGTH = 8_000;

function boundedPemPattern(label: string): RegExp {
  return new RegExp(
    `-----BEGIN ${label}-----[\\s\\S]{0,${String(MAX_PEM_BODY_LENGTH)}}?-----END ${label}-----`,
    "gu",
  );
}

/**
 * A redactor with its key and its user patterns already bound.
 */
export type Redactor = (text: string) => RedactionResult;

/**
 * **The one production entry to `redactText`, and the reason it exists is the key rather
 * than the patterns.** Binding both into a closure stops the key travelling as a
 * parameter through capture, review, ingest and init — fourteen call sites that each had
 * to be trusted not to log, hash or persist it (knowledge-pipeline spec §8.4). A closure
 * cannot be interpolated into a diagnostic by accident; a `Uint8Array` in scope can.
 *
 * The patterns come from `config.toml`'s `[redaction]` table and are literal substrings.
 * `RedactionOptions` states why they are not expressions, and the loader's
 * `redactionSchema` bounds their count and length (BACKLOG NEW-16).
 *
 * **The key is validated when the redactor runs, not when it is built**, which keeps
 * `redactText`'s existing contract exactly: the same `RangeError` on a short key, raised
 * at the same point relative to the text it was asked to redact.
 */
export function createRedactor(
  key: Uint8Array,
  options: RedactionOptions = {},
): Redactor {
  return (text: string) => redactText(text, key, options);
}

export function redactText(
  text: string,
  key: Uint8Array,
  options: RedactionOptions = {},
): RedactionResult {
  if (key.byteLength < 32) {
    throw new RangeError("Redaction key must contain at least 32 bytes");
  }

  /**
   * Normalized once, here, for every class — not per-candidate and not
   * per-window. NFC composition can shorten text (an NFD "e" + combining
   * acute is 2 code units, the precomposed "é" is 1); computing an offset
   * against one representation of `text` and slicing or splicing another
   * is the same category of bug regardless of which step does the
   * normalizing, so there is exactly one normalization and exactly one
   * string every candidate's `start`/`end` is measured against, sliced
   * from, and spliced into. The returned `text` is this NFC form — the
   * capture pipeline normalizes to NFC immediately after redaction anyway
   * (see e.g. `packages/brain/src/lint/lint.ts`'s own NFC folding), so this
   * is the form the caller was going to end up with two steps later.
   */
  const normalizedText = text.normalize("NFC");

  const candidates: RedactionCandidate[] = [];

  addWholeMatches(
    normalizedText,
    boundedPemPattern("(?:[A-Z0-9]+ )?PRIVATE KEY"),
    "private-key",
    candidates,
  );
  addCapturedMatches(
    normalizedText,
    /(?:^|[\r\n])\s*[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Za-z0-9_]*\s*=\s*([^\r\n]+)/gu,
    "env-secret",
    1,
    candidates,
  );
  addCapturedMatches(
    normalizedText,
    /Authorization\s*:\s*Bearer\s+([A-Za-z0-9._~+/=-]+)/giu,
    "bearer-token",
    1,
    candidates,
  );
  addWholeMatches(
    normalizedText,
    /(?:ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,})/gu,
    "provider-token",
    candidates,
  );
  /**
   * `[A-Z0-9 ]*` on both sides of the required word "CERTIFICATE", not just
   * a single optional prefix word: PEM labels put qualifiers on either side
   * ("CERTIFICATE REQUEST", "NEW CERTIFICATE REQUEST", "TRUSTED
   * CERTIFICATE"), and a prefix-only pattern misses every suffix case.
   * "PUBLIC KEY" shares no label word with "CERTIFICATE" and stays out of
   * scope for this class — DOS-P6's ratified nine classes have no
   * `public-key` entry.
   */
  addWholeMatches(
    normalizedText,
    boundedPemPattern("[A-Z0-9 ]*CERTIFICATE[A-Z0-9 ]*"),
    "certificate",
    candidates,
  );
  /**
   * The strictly more specific shape runs before credential-store's looser
   * key=value and password patterns, so an AWS-shaped value sitting after
   * the word "password" is classified as the service credential it is,
   * not the generic store entry it happens to resemble. The final JWT
   * segment is `*`, not `+`: an `alg: none` token has no signature.
   */
  addWholeMatches(
    normalizedText,
    /(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|(?:sk|rk)_live_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/gu,
    "service-credential",
    candidates,
  );
  /**
   * `~/.aws/credentials` and `.npmrc` value shapes, by exact key name — so
   * this never fires on ordinary prose and can safely run ahead of
   * `user-pattern`.
   */
  addCapturedMatches(
    normalizedText,
    /(?:aws_secret_access_key|aws_session_token|_authToken|_auth|_password)\s*[:=]\s*(\S+)/giu,
    "credential-store",
    1,
    candidates,
  );
  /**
   * `user-pattern` runs before `.netrc`'s two `password`-anchored patterns
   * below, not after (fix pass 2 review): fix pass 1 anchored those
   * patterns to context so they stopped matching prose, but `(\S+)` still
   * captures only the *first token* after "password" — so on a real
   * netrc-shaped match, a configured multi-token pattern that overlaps the
   * captured token was still shadowed, with the remaining tokens leaking
   * into plaintext (`"password Acme Corp Holdings"` →
   * `"password [REDACTED:credential-store] Corp Holdings"`, "Corp
   * Holdings" left in the clear). Running `user-pattern` first means it
   * claims the full configured span, so the password pattern's later,
   * narrower attempt at the same region is the one the overlap resolver
   * drops. `addUserPatterns` still no-ops when no patterns are configured,
   * so this reordering does not change output for any of the calls that
   * pass none. **That was every production call site until 2026-08-17**; `capture`,
   * `review` and `ingest` now pass the user's configured patterns, so this ordering is
   * live rather than latent (BACKLOG NEW-16).
   */
  addUserPatterns(normalizedText, options.userPatterns ?? [], candidates);
  /**
   * `.netrc`'s space-separated `password <value>` cannot be named by a
   * fixed key, so it is anchored by context instead: `password` as the
   * first token on a line, or preceded on the same line by one of
   * `.netrc`'s own record keywords (`machine`, `login`, `account`,
   * `default`). A bare `\bpassword\b` with no such anchor previously
   * matched "the password must be...", "if (password === input)", and
   * similar prose. There is no length floor on the captured value: context
   * is what distinguishes a credential from prose here, not an arbitrary
   * minimum length, so a real one-character `.netrc` password is still
   * covered.
   */
  addCapturedMatches(
    normalizedText,
    /(?:^|[\r\n])[ \t]*password\s*[:=]?\s*(\S+)/giu,
    "credential-store",
    1,
    candidates,
  );
  addCapturedMatches(
    normalizedText,
    /\b(?:machine|login|account|default)\b[^\r\n]*?\bpassword\b\s*[:=]?\s*(\S+)/giu,
    "credential-store",
    1,
    candidates,
  );

  for (const match of normalizedText.matchAll(/[A-Za-z0-9+/=_-]{40,}/gu)) {
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
    redacted += normalizedText.slice(cursor, candidate.start);
    redacted += `[REDACTED:${candidate.class}]`;
    findings.push({
      class: candidate.class,
      fingerprint: fingerprint(candidate.secret, key),
    });
    cursor = candidate.end;
  }
  redacted += normalizedText.slice(cursor);

  return { text: redacted, findings };
}
