import { createHmac } from "node:crypto";

export interface RedactionFinding {
  readonly class: string;
  readonly fingerprint: string;
  /**
   * `user-pattern` only: the zero-based position in `userPatterns` of the entry that
   * produced it, as configured. Non-secret — it names a table row, never its text (D73).
   */
  readonly patternIndex?: number;
}

export interface RedactionResult {
  readonly text: string;
  readonly findings: readonly RedactionFinding[];
  /**
   * Indexes of the user patterns whose own matches cover at least `OVER_BROAD_COVERAGE`
   * of this input (NEW-24). Absent, never empty, when there are none.
   */
  readonly overBroadPatterns?: readonly number[];
}

/**
 * `userPatterns` is the only caller-supplied redaction input, so it is kept
 * to literal substrings rather than regular expressions — a compiled
 * expression over capture text is a ReDoS surface, and this codebase bounds
 * no expression anywhere. Optional so a call site that passes no third argument keeps compiling
 * and behaving unchanged — which was written when there were two such sites and no others, and
 * is now the rule rather than the count: `createRedactor` is the production entry, three
 * commands bind the user's patterns through it, and `tests/repository/redactor-entry.test.ts`
 * refuses a fourth that reaches for `redactText` directly.
 */
export interface RedactionOptions {
  readonly userPatterns?: readonly string[];
}

/**
 * **Which leaf of a published document is being redacted** (NEW-36, NEW-39). `text` is the
 * historical contract — every class, NFC output — and stays the default because capture
 * content relies on it. The other three are for structured output and return the caller's
 * bytes unchanged when nothing matched, so a path handed out as NFD opens again.
 *
 * - `value`: every class; a string leaf of a payload.
 * - `path`: every class except `high-entropy`, which fires on a sixteen-hex capture id and a
 *   temporary directory's name and would destroy the path rather than a secret in it.
 * - `name`: every class except `user-pattern` — a product-owned key name keeps its schema
 *   whatever the user configured, while provider and credential shapes still redact in it.
 */
export type RedactionScope = "text" | "value" | "path" | "name";

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

/**
 * **The one test for "this text carries a redaction marker"** (NEW-130, D83 (5)): a value
 * built from redacted text — a file name, a discovered path — names nothing real. Any case
 * or spacing, because a model rewriting the text may not keep ours. No `g` flag, so `test`
 * keeps no `lastIndex` state between calls.
 */
export const REDACTION_MARKER_PATTERN = /\[\s*redacted\s*:/iu;

/**
 * A span of the normalized text; the secret is sliced from it at output, so a
 * merged range fingerprints exactly the text it redacts.
 */
interface RedactionCandidate {
  readonly start: number;
  readonly end: number;
  readonly class: string;
  readonly patternIndex?: number;
}

function overlaps(
  left: RedactionCandidate,
  right: RedactionCandidate,
): boolean {
  return left.start < right.end && right.start < left.end;
}

/**
 * Merges a candidate with every existing one it overlaps (NEW-25). Dropping it
 * instead left its non-overlapping part in the clear. The merged range keeps the
 * class of the earliest-scanned contributor, so the class order in `redactText`
 * still decides classification. Touching ranges are not overlaps and stay apart.
 * `high-entropy` never comes through here; see `addHighEntropyRun`.
 */
function addCandidate(
  candidates: RedactionCandidate[],
  candidate: RedactionCandidate,
): void {
  if (candidate.end <= candidate.start) return;
  const overlapping = candidates.filter((existing) => overlaps(existing, candidate));
  const [owner] = overlapping;
  if (owner === undefined) {
    candidates.push(candidate);
    return;
  }
  const merged: RedactionCandidate = {
    class: owner.class,
    start: overlapping.reduce((start, e) => Math.min(start, e.start), candidate.start),
    end: overlapping.reduce((end, e) => Math.max(end, e.end), candidate.end),
    ...(owner.patternIndex === undefined ? {} : { patternIndex: owner.patternIndex }),
  };
  candidates[candidates.indexOf(owner)] = merged;
  for (const absorbed of overlapping.slice(1)) {
    candidates.splice(candidates.indexOf(absorbed), 1);
  }
}

/** The head of a high-entropy run that is a `KEY=` name, not token material (D71). */
const ASSIGNMENT_KEY = /^[A-Za-z_][A-Za-z0-9_-]*=$/u;

/**
 * `high-entropy` is never merged (founder decision D71): its run spans a `KEY=` prefix,
 * so merging it would change the persisted fingerprint of an ordinary env or credential
 * line. Instead each part of the run no earlier candidate covers is redacted as its own
 * `high-entropy` range (NEW-120, D83 (6)), so a user pattern matching part of a token
 * leaves none of it in the clear. The one part kept is a head shaped `KEY=`: it names
 * the value, as in `API_TOKEN=…` or `key=AIza…`. Runs run last and never overlap each
 * other, so the pushed parts overlap nothing.
 */
function addHighEntropyRun(
  text: string,
  start: number,
  end: number,
  candidates: RedactionCandidate[],
): void {
  const covering = candidates
    .filter((existing) => existing.start < end && start < existing.end)
    .sort((left, right) => left.start - right.start);
  const head = text.slice(start, covering[0]?.start ?? start);
  let cursor = ASSIGNMENT_KEY.test(head) ? start + head.length : start;
  for (const existing of covering) {
    if (existing.start > cursor) {
      candidates.push({ start: cursor, end: existing.start, class: "high-entropy" });
    }
    cursor = Math.max(cursor, existing.end);
  }
  if (cursor < end) candidates.push({ start: cursor, end, class: "high-entropy" });
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

/**
 * **Over-broad is a property of the text, measured as the fraction of it one pattern's own
 * matches cover** (NEW-24, D73) — not of the pattern's length, which refused `EY` and every
 * two-character CJK name when it was tried (`redactionSchema` in the config loader). A
 * client name mentioned a few times covers 1–5% of a note; a common letter or word covers
 * 8% and up. Below the floor an input is too short to tell the two apart: a capture that is
 * nothing but the name covers all of it.
 *
 * ponytail: fixed threshold and floor; make them configurable if real notes disagree.
 */
const OVER_BROAD_COVERAGE = 0.08;
const OVER_BROAD_MIN_LENGTH = 256;

/** Returns the indexes of the patterns over-broad for `text`, ascending. */
function addUserPatterns(
  text: string,
  patterns: readonly string[],
  candidates: RedactionCandidate[],
): number[] {
  if (patterns.length === 0) return [];

  const folded = buildFoldedHaystack(text);
  /**
   * **Folded first, then de-duplicated, then sorted longest-first.**
   *
   * The ordering was the correctness argument while `addCandidate` was first-wins: an
   * unsorted scan let `["Acme", "Acme Corp"]` leave `Corp` in the clear, and a sort on the
   * raw rather than the folded string did the same for a decomposed (NFD) short form.
   * `addCandidate` now merges overlapping ranges (NEW-25), which closes both that and the
   * partial-overlap case ordering never could (`["Acme Corp", "Corp Holdings"]`); the
   * sort stays to keep the scan order independent of how the table was typed, which also
   * makes a merged finding keep the longest contributor's `patternIndex`.
   *
   * Folding before de-duplicating makes it mean what it says: `["Acme", "acme"]` is one
   * needle, scanned once, and indexed by the first of the two as configured (D73).
   */
  const firstIndexOf = new Map<string, number>();
  patterns.forEach((pattern, index) => {
    const needle = foldForMatching(pattern.normalize("NFC"));
    if (!firstIndexOf.has(needle)) firstIndexOf.set(needle, index);
  });
  const ordered = [...firstIndexOf].sort(
    ([a], [b]) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0),
  );
  const overBroad: number[] = [];
  for (const [needle, patternIndex] of ordered) {
    if (needle.length === 0) continue;
    let covered = 0;
    for (
      let at = folded.haystack.indexOf(needle);
      at >= 0;
      at = folded.haystack.indexOf(needle, at + needle.length)
    ) {
      const range = toOriginalRange(folded, at, needle.length);
      if (range === null) continue;
      covered += range.end - range.start;
      addCandidate(candidates, {
        start: range.start,
        end: range.end,
        class: "user-pattern",
        patternIndex,
      });
    }
    if (text.length >= OVER_BROAD_MIN_LENGTH && covered >= OVER_BROAD_COVERAGE * text.length) {
      overBroad.push(patternIndex);
    }
  }
  return overBroad.sort((a, b) => a - b);
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

/**
 * A word: one case throughout, a vowel unless it is at most three letters (`src`, `cli`),
 * and no longer than a real word gets. Short digit runs are dates and ids.
 */
function isWordLikePart(part: string): boolean {
  if (/^[0-9]{1,8}$/u.test(part)) return true;
  if (!/^(?:[a-z]{1,16}|[A-Z]{1,16})$/u.test(part)) return false;
  return part.length <= 3 || /[aeiouy]/iu.test(part);
}

/** The longest real note path seen (NEW-129) has 11 parts; a longer word chain is not exempt. */
const MAX_WORD_LIKE_PARTS = 12;

/**
 * NEW-129: a note path, wikilink target or kebab slug — every `/` segment made only of
 * word-like `-`/`_` parts, at most `MAX_WORD_LIKE_PARTS` of them in all. Anything else
 * (mixed case, letters beside digits, `+`, `=`) falls back to the whole-run entropy check,
 * so a token sitting in one segment still redacts the run. Known cost: an unlabelled
 * all-word passphrase joined by `-` is exempt too; a labelled one is credential-store.
 * ponytail: vowel test, not a dictionary; random vowel-bearing letter chunks still pass.
 */
function isWordLikePath(run: string): boolean {
  const parts = run
    .split("/")
    .flatMap((segment) => segment.split(/[-_]/u))
    .filter((part) => part.length > 0);
  return parts.length > 0 && parts.length <= MAX_WORD_LIKE_PARTS && parts.every(isWordLikePart);
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
export type Redactor = (text: string, scope?: RedactionScope) => RedactionResult;

/**
 * **The one production entry to `redactText`, and the reason it exists is the key rather
 * than the patterns.** Binding both into a closure stops the key travelling as a
 * parameter through capture, review, ingest and init — fourteen call sites that each had
 * to be trusted not to log, hash or persist it (knowledge-pipeline architecture note §8.1). A closure
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
  return (text: string, scope?: RedactionScope) => redactText(text, key, options, scope);
}

export function redactText(
  text: string,
  key: Uint8Array,
  options: RedactionOptions = {},
  scope: RedactionScope = "text",
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
  /** NEW-143 (D83 (1)): `sk-` not preceded by a letter or digit, so `task-…` or `mask-…` is a word. */
  addWholeMatches(
    normalizedText,
    /(?:ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|xox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,})/gu,
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
   * narrower attempt at the same region is absorbed into it and the merged
   * range keeps the `user-pattern` class. `addUserPatterns` still no-ops when no patterns are configured,
   * so this reordering does not change output for any of the calls that
   * pass none. **That was every production call site until 2026-08-17**; `capture`,
   * `review` and `ingest` now pass the user's configured patterns, so this ordering is
   * live rather than latent (BACKLOG NEW-16).
   */
  const overBroadPatterns =
    scope === "name" ? [] : addUserPatterns(normalizedText, options.userPatterns ?? [], candidates);
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
  /**
   * NEW-129 review: an all-word passphrase is exempt from high-entropy (`isWordLikePath`),
   * so a labelled one is caught here instead. `\bis\b`, not `is`, so "this" is no label.
   * Captures the rest of the line, like `env-secret` (NEW-130, D83 (5)): a space-separated
   * mnemonic is as secret as a hyphenated one. The cost is prose: "the passphrase is stored
   * in the keychain" loses everything after "is", not just "stored".
   */
  addCapturedMatches(
    normalizedText,
    /\b(?:pass ?phrase|mnemonic|seed phrase|recovery (?:phrase|key))\b[^\r\n]{0,20}?(?:\bis\b|[:=])\s*(\S(?:[^\r\n]*\S)?)/giu,
    "credential-store",
    1,
    candidates,
  );

  /**
   * Skipped at collection rather than filtered afterwards: a dropped candidate may have been
   * the owner another one merged into, so filtering would change NEW-25's merge outcome.
   */
  const heuristicRuns =
    scope === "path" ? [] : normalizedText.matchAll(/[A-Za-z0-9+/=_-]{40,}/gu);
  for (const match of heuristicRuns) {
    if (isWordLikePath(match[0]) || !looksHighEntropy(match[0])) {
      continue;
    }
    addHighEntropyRun(normalizedText, match.index, match.index + match[0].length, candidates);
  }

  /**
   * Matching still ran on NFC, so an NFD path carrying a configured pattern is caught; only a
   * leaf with nothing to redact keeps its bytes. A redacted leaf is destroyed either way.
   */
  if (scope !== "text" && candidates.length === 0) return { text, findings: [] };

  candidates.sort((left, right) => left.start - right.start);

  let cursor = 0;
  let redacted = "";
  const findings: RedactionFinding[] = [];
  for (const candidate of candidates) {
    redacted += normalizedText.slice(cursor, candidate.start);
    redacted += `[REDACTED:${candidate.class}]`;
    findings.push({
      class: candidate.class,
      fingerprint: fingerprint(
        normalizedText.slice(candidate.start, candidate.end),
        key,
      ),
      ...(candidate.patternIndex === undefined ? {} : { patternIndex: candidate.patternIndex }),
    });
    cursor = candidate.end;
  }
  redacted += normalizedText.slice(cursor);

  return overBroadPatterns.length === 0
    ? { text: redacted, findings }
    : { text: redacted, findings, overBroadPatterns };
}
