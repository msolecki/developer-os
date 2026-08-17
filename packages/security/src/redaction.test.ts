import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createRedactor,
  REDACTION_CLASSES,
  redactText,
  type RedactionResult,
} from "./redaction.js";

const deterministicKey = new Uint8Array(32).fill(7);
const environmentSecret = "synthetic-environment-value-91Xq";
const privateKeyBlock = [
  "-----BEGIN PRIVATE KEY-----", // gitleaks:allow -- synthetic test fixture
  "c3ludGhldGljLXRlc3QtbWF0ZXJpYWwtbm90LWtleQ==",
  "-----END PRIVATE KEY-----",
].join("\n");
const providerToken = `ghp_${"a1".repeat(18)}`;
const bearerSecret = "synthetic.Bearer_8vR2pL5mN9qT4xK7"; // gitleaks:allow -- synthetic test fixture
const highEntropySecret = "Z7qP2mN9vR4xK8cT1wH6jL3sF0dG5bY2uI7oE9aQ4zX8"; // gitleaks:allow -- synthetic test fixture
const lowercaseHexSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // gitleaks:allow -- synthetic test fixture
const lowercaseAlphanumericSecret = "m7q2v9k4n8c3x6b1z5j0h7d2s9f4g8l3p6r1t5w0y7u2"; // gitleaks:allow -- synthetic test fixture
const certificateBlock = [
  "-----BEGIN CERTIFICATE-----",
  "QUJDREVGR0g=",
  "-----END CERTIFICATE-----",
].join("\n");
const awsAccessKeyId = "AKIAIOSFODNN7EXAMPLE"; // gitleaks:allow -- AWS's own published placeholder shape, not a real key
const stripeLiveKey = "sk_live_0123456789abcdef"; // gitleaks:allow -- synthetic test fixture
const googleApiKey = "AIzasYnTh3ticKeyMaterial0000-Example_9x"; // gitleaks:allow -- synthetic test fixture
const jwtTriplet =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzeW50aGV0aWMtdXNlciJ9.c3ludGhldGljLXNpZ25hdHVyZS12YWx1ZQ"; // gitleaks:allow -- synthetic test fixture, decodes to a made-up subject and signature
const awsCredentialLine =
  "aws_secret_access_key = synthetic/AwsSecretMaterial+ExampleKey00"; // gitleaks:allow -- synthetic test fixture
const netrcLine =
  "machine example.test login syntheticuser password synthetic-netrc-secret-99"; // gitleaks:allow -- synthetic test fixture
const npmrcLine =
  "//registry.example.test/:_authToken=synthetic-npm-token-abc123"; // gitleaks:allow -- synthetic test fixture

function expectRedacted(result: RedactionResult, secret: string): void {
  expect(result.text).not.toContain(secret);
  expect(result.findings.length).toBeGreaterThan(0);
  expect(JSON.stringify(result)).not.toContain(secret);

  for (const finding of result.findings) {
    expect(finding.fingerprint).toMatch(/^[a-f0-9]{16}$/);
  }

  expect(
    result.findings.some((finding) =>
      result.text.includes(`[REDACTED:${finding.class}]`),
    ),
  ).toBe(true);
}

describe("redactText", () => {
  it("redacts an environment secret assignment", () => {
    const result = redactText(
      `API_TOKEN=${environmentSecret}`,
      deterministicKey,
    );

    expectRedacted(result, environmentSecret);
  });

  it("redacts a PEM private key block", () => {
    const result = redactText(
      `before\n${privateKeyBlock}\nafter`,
      deterministicKey,
    );

    expectRedacted(result, privateKeyBlock);
  });

  it("redacts a provider token", () => {
    const result = redactText(`token: ${providerToken}`, deterministicKey);

    expectRedacted(result, providerToken);
  });

  it("redacts an Authorization bearer value", () => {
    const result = redactText(
      `Authorization: Bearer ${bearerSecret}`,
      deterministicKey,
    );

    expectRedacted(result, bearerSecret);
  });

  it("redacts a high-entropy mixed string", () => {
    const result = redactText(
      `opaque value ${highEntropySecret}`,
      deterministicKey,
    );

    expectRedacted(result, highEntropySecret);
  });

  it("redacts a 64-character lowercase hexadecimal secret", () => {
    const result = redactText(
      `hex material ${lowercaseHexSecret}`,
      deterministicKey,
    );

    expectRedacted(result, lowercaseHexSecret);
  });

  it("redacts a long random-looking lowercase alphanumeric secret", () => {
    const result = redactText(
      `opaque lowercase value ${lowercaseAlphanumericSecret}`,
      deterministicKey,
    );

    expectRedacted(result, lowercaseAlphanumericSecret);
  });

  it("uses deterministic keyed fingerprints", () => {
    const source = `API_TOKEN=${environmentSecret}`;
    const first = redactText(source, deterministicKey);
    const repeated = redactText(source, deterministicKey);
    const otherKey = redactText(source, new Uint8Array(32).fill(9));
    const [firstFinding] = first.findings;
    const [repeatedFinding] = repeated.findings;
    const [otherKeyFinding] = otherKey.findings;

    expect(firstFinding).toBeDefined();
    expect(repeatedFinding).toBeDefined();
    expect(otherKeyFinding).toBeDefined();
    if (!firstFinding || !repeatedFinding || !otherKeyFinding) {
      throw new Error("Expected a redaction finding for every keyed invocation");
    }

    expect(repeatedFinding.fingerprint).toBe(firstFinding.fingerprint);
    expect(otherKeyFinding.fingerprint).not.toBe(firstFinding.fingerprint);
    expect(firstFinding.fingerprint).toBe(
      createHmac("sha256", deterministicKey)
        .update(environmentSecret)
        .digest("hex")
        .slice(0, 16),
    );
  });

  it("rejects a fingerprint key shorter than 32 bytes", () => {
    expect(() => redactText("API_TOKEN=synthetic", new Uint8Array(31))).toThrow();
  });

  it("leaves nonsecret text unchanged without findings", () => {
    const source = "ordinary synthetic status text";

    expect(redactText(source, deterministicKey)).toEqual({
      text: source,
      findings: [],
    });
  });

  describe("overlap resolution guards the five existing classes", () => {
    it("does not let the certificate pattern intercept a private key block", () => {
      const result = redactText(
        `before\n${privateKeyBlock}\nafter`,
        deterministicKey,
      );

      expect(result.findings.map((f) => f.class)).toEqual(["private-key"]);
    });

    it("does not let credential-store intercept an env secret assignment", () => {
      const result = redactText(
        `API_TOKEN=${environmentSecret}`,
        deterministicKey,
      );

      expect(result.findings.map((f) => f.class)).toEqual(["env-secret"]);
    });

    it("does not let service-credential intercept an Authorization bearer value", () => {
      const result = redactText(
        `Authorization: Bearer ${bearerSecret}`,
        deterministicKey,
      );

      expect(result.findings.map((f) => f.class)).toEqual(["bearer-token"]);
    });

    it("does not let service-credential intercept a provider token", () => {
      const result = redactText(`token: ${providerToken}`, deterministicKey);

      expect(result.findings.map((f) => f.class)).toEqual(["provider-token"]);
    });

    it("does not let service-credential intercept a high-entropy value", () => {
      const result = redactText(
        `opaque value ${highEntropySecret}`,
        deterministicKey,
      );

      expect(result.findings.map((f) => f.class)).toEqual(["high-entropy"]);
    });
  });

  describe("certificate", () => {
    it("redacts a PEM certificate block, which the private-key pattern does not match", () => {
      const source = `-----BEGIN CERTIFICATE-----\nQUJDREVGR0g=\n-----END CERTIFICATE-----`;
      const { text, findings } = redactText(source, deterministicKey);
      expect(text).toBe("[REDACTED:certificate]");
      expect(findings.map((f) => f.class)).toEqual(["certificate"]);
    });

    it("does not redact plain text that merely mentions a certificate", () => {
      const result = redactText(
        "Please renew the certificate before Friday",
        deterministicKey,
      );

      expect(result.findings).toHaveLength(0);
    });

    it.each([
      "CERTIFICATE REQUEST",
      "NEW CERTIFICATE REQUEST",
      "TRUSTED CERTIFICATE",
    ])("redacts a PEM block labeled %s (finding 8)", (label) => {
      const source = `-----BEGIN ${label}-----\nQUJDREVGR0g=\n-----END ${label}-----`;
      const result = redactText(source, deterministicKey);

      expect(result.findings.map((f) => f.class)).toEqual(["certificate"]);
    });

    /**
     * Finding 8 (fix pass 1 review): `PUBLIC KEY` shares no label word with
     * `CERTIFICATE`, so it is out of scope for this class rather than a
     * miss — DOS-P6's ratified nine classes have no `public-key` entry, and
     * inventing one is a decision for a future task, not a silent widening
     * here.
     */
    it("does not redact a PUBLIC KEY block, which is out of scope for this class", () => {
      const source =
        "-----BEGIN PUBLIC KEY-----\nQUJDREVGR0g=\n-----END PUBLIC KEY-----";
      const result = redactText(source, deterministicKey);

      expect(result.findings).toHaveLength(0);
    });
  });

  describe("credential-store", () => {
    it("redacts an ~/.aws/credentials secret access key value", () => {
      const result = redactText(awsCredentialLine, deterministicKey);

      expectRedacted(result, "synthetic/AwsSecretMaterial+ExampleKey00");
      expect(result.findings.map((f) => f.class)).toEqual(["credential-store"]);
    });

    it("redacts a .netrc password value", () => {
      const result = redactText(netrcLine, deterministicKey);

      expectRedacted(result, "synthetic-netrc-secret-99");
      expect(result.findings.map((f) => f.class)).toEqual(["credential-store"]);
    });

    it("redacts a .npmrc auth token value", () => {
      const result = redactText(npmrcLine, deterministicKey);

      expectRedacted(result, "synthetic-npm-token-abc123");
      expect(result.findings.map((f) => f.class)).toEqual(["credential-store"]);
    });

    it("does not redact an unrelated identifier that merely contains the word password", () => {
      const result = redactText(
        "my_password_manager=strongvalue",
        deterministicKey,
      );

      expect(result.findings).toHaveLength(0);
    });

    it("redacts a password value that uses a colon separator", () => {
      const result = redactText(
        "machine example.test login syntheticuser password: synthetic-colon-secret",
        deterministicKey,
      );

      expectRedacted(result, "synthetic-colon-secret");
      expect(result.findings.map((f) => f.class)).toEqual([
        "credential-store",
      ]);
    });

    it("redacts a real one-character .netrc password value", () => {
      const result = redactText(
        "machine example.test login syntheticuser password x",
        deterministicKey,
      );

      expect(result.findings.map((f) => f.class)).toEqual([
        "credential-store",
      ]);
    });

    /**
     * Critical 2 (fix pass 1 review): `\bpassword\s+(\S{3,})` fired on
     * ordinary prose because it had no context requirement beyond the word
     * itself. Anchoring to a line-start or a `machine`/`login`/`account`/
     * `default` record — the shapes `.netrc` actually uses — closes that
     * without a length floor standing in for context.
     */
    it.each([
      "Rotate the password every 90 days",
      "// the password must be at least 12",
      "if (password === input)",
    ])("does not redact ordinary prose containing the word password: %s", (prose) => {
      const result = redactText(prose, deterministicKey);

      expect(result.findings).toHaveLength(0);
    });

    it("does not let a bare 'password' in prose shadow an overlapping user pattern (Critical 2)", () => {
      const { text, findings } = redactText(
        "Reset the password Acme Corp Holdings account",
        deterministicKey,
        { userPatterns: ["acme corp holdings"] },
      );

      expect(text).toBe("Reset the password [REDACTED:user-pattern] account");
      expect(text).not.toContain("Corp Holdings");
      expect(findings.map((f) => f.class)).toEqual(["user-pattern"]);
    });

    /**
     * Critical 2, fix pass 2 review: narrowing the trigger in fix pass 1
     * left the leak mechanism itself in place. Both password patterns ran
     * before `addUserPatterns`, so a real netrc-shaped match still let
     * `(\S+)` claim only the first token of a multi-token user pattern —
     * the case above doesn't exercise this because neither password
     * pattern fires on "Reset the password ...". These two do fire: the
     * first is the line-start form, the second the machine/login-record
     * form. Pinned against the ordering, not one string — moving
     * `addUserPatterns` back below the password patterns must fail both.
     */
    it.each([
      "password Acme Corp Holdings",
      "machine x login y password Acme Corp Holdings",
    ])(
      "does not let a credential-store password pattern claim one token of an overlapping user pattern: %s",
      (source) => {
        const { text, findings } = redactText(source, deterministicKey, {
          userPatterns: ["acme corp holdings"],
        });

        expect(text).toContain("[REDACTED:user-pattern]");
        expect(text).not.toContain("Corp Holdings");
        expect(findings.map((f) => f.class)).toEqual(["user-pattern"]);
      },
    );
  });

  describe("service-credential", () => {
    it("redacts an AWS access key id and a Stripe live key", () => {
      const { findings } = redactText(
        `${awsAccessKeyId} and ${stripeLiveKey}`,
        deterministicKey,
      );
      expect(findings.map((f) => f.class)).toEqual([
        "service-credential",
        "service-credential",
      ]);
    });

    it("redacts a Google API key and a JWT triplet", () => {
      const result = redactText(
        `key=${googleApiKey} token=${jwtTriplet}`,
        deterministicKey,
      );

      expect(result.findings.map((f) => f.class)).toEqual([
        "service-credential",
        "service-credential",
      ]);
      expectRedacted(result, googleApiKey);
      expectRedacted(result, jwtTriplet);
    });

    it("does not redact a Stripe test key, which is not a live credential", () => {
      const result = redactText(
        "sk_test_0123456789abcdef",
        deterministicKey,
      );

      expect(result.findings).toHaveLength(0);
    });

    it("redacts an alg:none JWT, whose signature segment is empty", () => {
      const algNoneJwt =
        "eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMtdXNlciJ9."; // gitleaks:allow -- synthetic test fixture, no signature by construction
      const result = redactText(algNoneJwt, deterministicKey);

      expect(result.findings.map((f) => f.class)).toEqual([
        "service-credential",
      ]);
    });
  });

  describe("overlap resolution guards the four new classes against each other", () => {
    /**
     * Finding 7 (fix pass 1 review): service-credential is the strictly
     * more specific shape and must run first, or an AWS-shaped value that
     * happens to sit after the word "password" gets classified under the
     * looser credential-store pattern instead.
     */
    it("classifies an AWS-shaped netrc password as service-credential, not credential-store", () => {
      const result = redactText(
        "machine example.test login syntheticuser password AKIAIOSFODNN7EXAMPLE",
        deterministicKey,
      );

      expect(result.findings.map((f) => f.class)).toEqual([
        "service-credential",
      ]);
    });

    /**
     * Fix pass 2 review: the previous version of this test passed
     * `userPatterns: ["synthetic-user"]` against the JWT fixture, but that
     * literal never occurs in the text — it is base64 *inside* the token,
     * not a substring of it — so the assertion held with or without the
     * pattern and proved nothing. This one uses a pattern that genuinely
     * occurs in the text and genuinely competes with credential-store's
     * password anchor for the same region (the Critical-2 fix pass 2 case).
     */
    it("keeps a configured user pattern intact when credential-store's password anchor would otherwise claim part of it", () => {
      const { findings } = redactText(
        "machine x login y password Acme Corp Holdings",
        deterministicKey,
        { userPatterns: ["acme corp holdings"] },
      );

      expect(findings.map((f) => f.class)).toEqual(["user-pattern"]);
    });
  });

  describe("user-pattern", () => {
    it("matches a user pattern case-insensitively and as a literal, never as a regex", () => {
      const { text, findings } = redactText("The ACME Corp report", deterministicKey, {
        userPatterns: ["acme corp"],
      });
      expect(text).toBe("The [REDACTED:user-pattern] report");
      expect(findings).toHaveLength(1);
    });

    it("treats regex metacharacters in a user pattern as literal text", () => {
      expect(
        redactText("a.c", deterministicKey, { userPatterns: [".*"] }).text,
      ).toBe("a.c");
      expect(
        redactText("literal .* here", deterministicKey, {
          userPatterns: [".*"],
        }).text,
      ).toBe("literal [REDACTED:user-pattern] here");
    });

    /**
     * Finding 10 (fix pass 1 review): this proves the pattern is never
     * *compiled* as a regular expression — an unescaped `(a+)+$` catastrophically
     * backtracks in well under 50,000 characters if it reaches `RegExp`, so
     * a sub-second result here is evidence the literal path was taken. It
     * does **not** prove the literal-matching implementation itself is
     * linear in text size or pattern count — see the `indexOf`-performance
     * tests below for that.
     */
    it("does not backtrack on a pathological pattern", () => {
      const started = performance.now();
      redactText("a".repeat(50_000), deterministicKey, {
        userPatterns: ["(a+)+$"],
      });
      expect(performance.now() - started).toBeLessThan(1_000);
    });

    /**
     * Important 5 (fix pass 1 review, ceiling corrected in fix pass 2,
     * ceiling replaced with a same-run ratio in fix pass 3, baseline
     * corrected to share the ratio's allocation profile in fix pass 4,
     * input size and repetition count cut in fix pass 5): the first
     * shipped implementation re-sliced and re-lowered a window at every
     * text position for every pattern — O(n·m) per pattern.
     *
     * An absolute wall-clock ceiling is a race against whatever else the
     * machine is doing (fix pass 1: 697 ms measured against a 600 ms
     * ceiling on otherwise-passing hardware). A ratio against a
     * zero-pattern baseline is not load-invariant either, because
     * `addUserPatterns` returns before `buildFoldedHaystack` ever runs at
     * zero patterns, so the baseline never pays the allocation the
     * measurement does (fix pass 4). Giving the baseline one pattern
     * instead of zero fixed that — but at 2 MB and five repetitions each,
     * the fixed version of this test cost ~4.2 s in isolation, and went
     * over vitest's 5 s default under `npm run check`'s parallel workers
     * (fix pass 4 verified only `pnpm vitest run` in isolation, which does
     * not reproduce parallel-worker contention — exactly how this reached
     * the coordinator).
     *
     * Cut to **512 KB, three repetitions each** (six `redactText` calls
     * total, plus two untimed warm-ups) rather than widening the timeout
     * around the larger size: the separation between the fixed and buggy
     * implementations is a property of the *algorithm's shape*
     * (allocate-once-then-`indexOf`-per-pattern vs. reslice-and-refold
     * per position per pattern), not of input size, so there was no reason
     * to keep paying for 2 MB once that was confirmed. Recalibrated,
     * min-of-3, 512 KB, by temporarily reintroducing the exact pre-fix
     * shape:
     * - Fixed, no load, 20 samples across independent process launches:
     *   ratio 0.63-1.25.
     * - Fixed, under 16-way background CPU load
     *   (`node -e 'while(true){Math.sqrt(Math.random())}'` ×16, `pkill`
     *   after), 5 samples: ratio 0.66-1.46 — still no meaningful drift
     *   from the no-load range at this smaller size.
     * - Buggy (reintroduced), no load, 20 samples: ratio 6.32-7.99.
     * - Buggy, no separate under-load measurement taken at this size: the
     *   no-load floor (6.32) already sits far above every fixed ceiling
     *   observed (1.46), and fix pass 4 already established the buggy
     *   shape's ratio *rises* under load rather than falling, so a
     *   dedicated under-load buggy measurement would only widen the gap
     *   further, not narrow it.
     * Every fixed measurement observed, loaded or not, stayed under 1.5;
     * every buggy measurement observed stayed over 6.3. 3 keeps wide
     * margin on both sides — roughly 2× the highest fixed measurement and
     * half the lowest buggy one — same as fix pass 4's ceiling, unchanged
     * because the *ratio* a correct implementation produces does not
     * depend on input size, only the absolute time to compute it does.
     *
     * This proves the *shape* changed back to a per-position rescan if it
     * regresses; it does not certify a specific throughput bound for
     * arbitrary text or pattern sizes.
     */
    it(
      "adds bounded per-pattern overhead over a single-pattern baseline, not a per-position rescan",
      () => {
        const text = "x".repeat(512 * 1024);
        const baselinePattern = ["pattern-0-not-present-in-text-xyz"];
        const patterns = Array.from(
          { length: 10 },
          (_, index) => `pattern-${String(index)}-not-present-in-text-xyz`,
        );

        function minElapsed(run: () => void, repetitions: number): number {
          let best = Infinity;
          for (let index = 0; index < repetitions; index += 1) {
            const started = performance.now();
            run();
            const elapsed = performance.now() - started;
            if (elapsed < best) best = elapsed;
          }
          return best;
        }

        // One untimed warm-up call each, so the first *timed* repetition is
        // not the one absorbing JIT compilation for a code path the rest of
        // this suite may not have exercised yet.
        redactText(text, deterministicKey, { userPatterns: baselinePattern });
        redactText(text, deterministicKey, { userPatterns: patterns });

        const baseline = minElapsed(
          () => redactText(text, deterministicKey, { userPatterns: baselinePattern }),
          3,
        );
        const withPatterns = minElapsed(
          () => redactText(text, deterministicKey, { userPatterns: patterns }),
          3,
        );

        // `+ 20` absorbs timer-resolution noise when `baseline` itself is
        // small; the multiplier is what actually separates the two
        // implementations, per the calibration above.
        expect(withPatterns).toBeLessThan(baseline * 3 + 20);
      },
      // Declared explicitly rather than inherited from vitest's 5 s
      // default: this test deliberately does more work than its
      // neighbours (six full passes over 512 KB), and fix pass 4's
      // version of this test blowing past that same *inherited* default
      // under parallel-worker load is the failure this pass exists to
      // fix. 2,000 ms is a wide multiple of every measurement above: the
      // heaviest combined `baseline` + `withPatterns` min-time observed,
      // under synthetic 16-way background CPU load at this same 512 KB
      // size, was ~550 ms — and that number already excludes the two
      // untimed warm-up calls, so it undercounts the real body time
      // somewhat, which is exactly why the multiple is wide rather than
      // tight.
      2_000,
    );

    it("keeps overlap resolution: the first candidate wins and the second is dropped", () => {
      const { findings } = redactText(awsAccessKeyId, deterministicKey, {
        userPatterns: [awsAccessKeyId],
      });
      expect(findings).toHaveLength(1);
    });

    it("does not misalign offsets when a preceding character's lowercase form is longer, e.g. U+0130", () => {
      const marker = "synthetic-marker-value";
      const source = `İ ${marker} here`;
      const { text, findings } = redactText(source, deterministicKey, {
        userPatterns: [marker],
      });

      expect(text).toBe("İ [REDACTED:user-pattern] here");
      expect(findings).toHaveLength(1);
    });

    /**
     * Important 3 (fix pass 1 review): a pattern that IS the U+0130 shape
     * must match its own exact occurrence — the fixed shape here is that
     * `toLowerCase()` expands `İ` into two code units (`i` + U+0307
     * COMBINING DOT ABOVE) whether it appears in the pattern or the text,
     * and a single materialized haystack folds both the same way, so the
     * expanded forms line up byte-for-byte.
     */
    it("matches a user pattern that is itself the U+0130 shape, against its own exact occurrence", () => {
      const { text, findings } = redactText(
        "client İstanbul group",
        deterministicKey,
        { userPatterns: ["İstanbul"] },
      );

      expect(text).toBe("client [REDACTED:user-pattern] group");
      expect(findings).toHaveLength(1);
    });

    /**
     * Documented gap, not a regression: `toLowerCase()` folds `İ` to
     * `i` + U+0307, never to bare `i` — so a *dotless* pattern can never
     * match *dotted* text that folds through U+0130, in either direction.
     * Closing this needs Turkish-locale-aware or mark-stripping folding,
     * which would also fold unrelated diacritics away (e.g. `cafe` would
     * start matching `café`) and so widen "case-insensitive" (spec §8.2)
     * into "diacritic-insensitive" — a decision for a future task, not a
     * silent behavior change here.
     */
    it("does not match a dotless pattern against text that folds through U+0130", () => {
      const result = redactText("client İSTANBUL group", deterministicKey, {
        userPatterns: ["istanbul"],
      });

      expect(result.findings).toHaveLength(0);
    });

    it("does not redact when no configured pattern occurs in the text", () => {
      const result = redactText("nothing to see here", deterministicKey, {
        userPatterns: ["acme corp"],
      });

      expect(result.findings).toHaveLength(0);
    });
  });

  describe("NFC normalization is applied once, over the whole input (Critical 1)", () => {
    /**
     * The first shipped fix folded case per user-pattern window but still
     * normalized the whole haystack to NFC as a separate pass, then used
     * NFC-space offsets directly against the un-normalized `text` — the
     * same category of bug as the toLowerCase one, just with NFC's
     * *shortening* instead of toLowerCase's lengthening. NFC composes an
     * NFD "e" + combining acute accent (2 code units) into one precomposed
     * "é" (1 code unit): every offset after such a character was off by
     * one per composed character, in the original, un-normalized `text`
     * that both the "secret" field and the final splice used.
     *
     * Reproduced against the pre-fix code: `redactText("café/report
     * ACME-CORP-SECRET end", key, { userPatterns: ["ACME-CORP-SECRET"] })`
     * returned `"café/report[REDACTED:user-pattern]T end"` — the trailing
     * "T" of "SECRET" survived in plaintext.
     */
    it("does not leak a trailing character of a matched secret behind an NFD-decomposed prefix", () => {
      const nfdCafe = "café"; // "café" decomposed: "e" + U+0301 COMBINING ACUTE ACCENT
      const source = `${nfdCafe}/report ACME-CORP-SECRET end`;
      const { text } = redactText(source, deterministicKey, {
        userPatterns: ["ACME-CORP-SECRET"],
      });

      expect(text).not.toContain("SECRET");
      expect(text).not.toContain("T end");
      expect(text).toBe(
        `${nfdCafe.normalize("NFC")}/report [REDACTED:user-pattern] end`,
      );
    });

    it("does not leak a fragment behind two NFD-decomposed characters ahead of the match", () => {
      const nfdNaive = "naïve"; // "naïve" decomposed: "i" + U+0308 COMBINING DIAERESIS
      const nfdCafe = "café";
      const source = `${nfdCafe} ${nfdNaive} ACME-CORP-SECRET end`;
      const { text } = redactText(source, deterministicKey, {
        userPatterns: ["ACME-CORP-SECRET"],
      });

      expect(text).not.toContain("SECRET");
      expect(text).not.toContain("ET end");
    });

    it("fingerprints a matched value identically regardless of an NFD-decomposed prefix", () => {
      const withoutPrefix = redactText("ACME-CORP-SECRET end", deterministicKey, {
        userPatterns: ["ACME-CORP-SECRET"],
      });
      const withNfdPrefix = redactText(
        `café/report ACME-CORP-SECRET end`,
        deterministicKey,
        { userPatterns: ["ACME-CORP-SECRET"] },
      );

      expect(withoutPrefix.findings).toHaveLength(1);
      expect(withNfdPrefix.findings).toHaveLength(1);
      expect(withNfdPrefix.findings[0]?.fingerprint).toBe(
        withoutPrefix.findings[0]?.fingerprint,
      );
    });

    it("returns NFC-normalized text even when nothing is redacted", () => {
      const nfdCafe = "café";
      const result = redactText(nfdCafe, deterministicKey);

      expect(result.text).toBe(nfdCafe.normalize("NFC"));
      expect(result.text).not.toBe(nfdCafe);
    });
  });

  describe("certificate and private-key bodies do not go quadratic (Important 6)", () => {
    /**
     * The lazy `[\s\S]*?` body rescans to end-of-input for every unmatched
     * `BEGIN`. Measured before the fix: 8,000 unterminated markers took
     * 482 ms, 16,000 took 1,765 ms — worse than linear, heading toward
     * multi-second stalls at realistic capture sizes. 16,000 is the size
     * used here because 8,000 stays under the 1 s ceiling even unfixed and
     * would not have caught this — bounding the body length caps each
     * failed attempt's rescan instead of letting it run to end-of-string.
     */
    it("does not go quadratic on many unterminated certificate markers", () => {
      const source = "-----BEGIN CERTIFICATE-----\n".repeat(16_000);
      const started = performance.now();
      redactText(source, deterministicKey);
      expect(performance.now() - started).toBeLessThan(1_000);
    });

    it("does not go quadratic on many unterminated private-key markers", () => {
      const source = "-----BEGIN PRIVATE KEY-----\n".repeat(16_000);
      const started = performance.now();
      redactText(source, deterministicKey);
      expect(performance.now() - started).toBeLessThan(1_000);
    });
  });

  describe("REDACTION_CLASSES", () => {
    it("is frozen and has nine members enumerated from real findings, not a hand-written list", () => {
      const fixtures: Record<string, () => RedactionResult> = {
        "private-key": () =>
          redactText(`before\n${privateKeyBlock}\nafter`, deterministicKey),
        "env-secret": () =>
          redactText(`API_TOKEN=${environmentSecret}`, deterministicKey),
        "bearer-token": () =>
          redactText(
            `Authorization: Bearer ${bearerSecret}`,
            deterministicKey,
          ),
        "provider-token": () =>
          redactText(`token: ${providerToken}`, deterministicKey),
        "high-entropy": () =>
          redactText(`opaque value ${highEntropySecret}`, deterministicKey),
        certificate: () => redactText(certificateBlock, deterministicKey),
        "credential-store": () =>
          redactText(awsCredentialLine, deterministicKey),
        "service-credential": () =>
          redactText(awsAccessKeyId, deterministicKey),
        "user-pattern": () =>
          redactText("The ACME Corp report", deterministicKey, {
            userPatterns: ["acme corp"],
          }),
      };

      const observedClasses = new Set<string>();
      for (const runFixture of Object.values(fixtures)) {
        for (const finding of runFixture().findings) {
          observedClasses.add(finding.class);
        }
      }

      expect(Object.isFrozen(REDACTION_CLASSES)).toBe(true);
      expect(REDACTION_CLASSES).toHaveLength(9);
      expect([...observedClasses].sort()).toEqual(
        [...REDACTION_CLASSES].sort(),
      );
    });
  });
});

/**
 * Spec §8.2's user-extensible class had no production caller and no configuration key —
 * every one of fourteen call sites passed two arguments, and `configSchema` is `.strict()`
 * (BACKLOG NEW-16). `createRedactor` is the seam that wires it, and the reason it binds
 * rather than threads is the *key*: a closure cannot be logged into a diagnostic by
 * accident, where a `Uint8Array` parameter travelling through capture, review, ingest and
 * init had to be trusted at every stop (spec §8.4).
 */
describe("createRedactor", () => {
  it("binds user patterns, so a caller cannot redact without them", () => {
    const redact = createRedactor(deterministicKey, {
      userPatterns: ["Northwind Traders"],
    });
    const result = redact("a note about Northwind Traders and nothing else");
    expect(result.text).not.toContain("Northwind Traders");
    expect(result.findings.map((finding) => finding.class)).toContain("user-pattern");
  });

  /** `addUserPatterns` folds to NFC and lower-cases, so the match is case-insensitive. */
  it("matches a configured pattern regardless of case", () => {
    const redact = createRedactor(deterministicKey, {
      userPatterns: ["Northwind Traders"],
    });
    expect(redact("northwind traders").text).not.toContain("northwind traders");
  });

  it("behaves exactly as redactText does when no patterns are configured", () => {
    expect(createRedactor(deterministicKey)("plain text with no secret")).toStrictEqual(
      redactText("plain text with no secret", deterministicKey),
    );
  });

  /**
   * `addCandidate` is first-wins on overlap, so an unordered scan made the result depend
   * on how the user typed the table: with `["Acme", "Acme Corp"]` the short form won and
   * **`Corp` stayed in the clear**. Listing both forms of a client name is the obvious
   * thing to do, so this is the ordinary case rather than an edge one.
   */
  it("redacts the longest pattern when two overlap, in either configured order", () => {
    const text = "hello Acme Corp bye";
    for (const userPatterns of [
      ["Acme", "Acme Corp"],
      ["Acme Corp", "Acme"],
    ]) {
      const result = createRedactor(deterministicKey, { userPatterns })(text);
      expect(result.text, userPatterns.join("|")).toBe(
        "hello [REDACTED:user-pattern] bye",
      );
      expect(result.text, userPatterns.join("|")).not.toContain("Corp");
    }
  });

  /**
   * **The ordering is on the *folded* pattern, and this is the case that proves it.**
   * Matching happens on `normalize("NFC").toLowerCase()`; sorting on the raw string
   * instead reintroduces the shadowing above, deterministically, whenever a pattern
   * arrives decomposed — which macOS filenames and Finder copy-paste produce. The
   * decomposed short form is *longer* raw and *shorter* folded, so a raw sort puts it
   * first and leaves ` Co` in the clear in both configured orders.
   */
  it("orders on the folded pattern, so a decomposed name does not shadow its longer form", () => {
    const short = "Nguyễn Văn Ánh".normalize("NFD");
    const long = "Nguyễn Văn Ánh Co".normalize("NFC");
    const fold = (value: string): string => {
      let out = "";
      for (const character of value.normalize("NFC")) out += character.toLowerCase();
      return out;
    };
    expect(short.length, "the fixture needs raw length to disagree").toBeGreaterThan(
      long.length,
    );
    /**
     * And the folded relation must be the *other* way round, or the fixture stops
     * exercising the hazard while the raw guard above still passes.
     */
    expect(fold(short).length, "folded lengths must invert the raw ones").toBeLessThan(
      fold(long).length,
    );
    for (const userPatterns of [
      [short, long],
      [long, short],
    ]) {
      const result = createRedactor(deterministicKey, { userPatterns })(
        `invoice for ${long} today`,
      );
      expect(result.text, userPatterns.join("|")).toBe(
        "invoice for [REDACTED:user-pattern] today",
      );
    }
  });

  /**
   * **The needle and the haystack fold by one rule, and this is the case that proved they
   * did not.** The haystack folds per character, because it maps folded offsets back to
   * original ones; a needle folded whole-string disagrees, because `toLowerCase` applies
   * Unicode's Final_Sigma mapping to a string and not to an isolated character. `"ΟΔΟΣ"`
   * folds to `"οδος"` one way and `"οδοσ"` the other.
   *
   * The failure was a **silent miss**: a Greek company name in capitals — how it appears
   * on a letterhead — configured and never redacted, with no error and no finding. That
   * is precisely what BACKLOG NEW-16 exists to prevent.
   */
  /**
   * **Deliberately not a mirror of production's `foldForMatching`** — it stops at the
   * per-character lowercase and omits the sigma unification, because it models the
   * *broken* half of the disagreement the guard below asserts still exists. Making the
   * two agree would silently disarm that guard.
   */
  const perCharacterLower = (value: string): string => {
    let out = "";
    for (const character of value) out += character.toLowerCase();
    return out;
  };

  /**
   * **The case the `it.each` below cannot reach, and the one that matters more.** Those
   * fixtures match a pattern against *itself*, uppercase over uppercase. Unifying the
   * folding rule on both sides fixed that and **moved** the miss rather than removing it:
   * an all-caps pattern from a letterhead stopped matching `οδος`, which is how the word
   * is ordinarily written in a sentence and therefore the likelier spelling in a capture.
   *
   * Greek writes one letter two ways by position. `toLowerCase` preserves the
   * distinction, so `foldForMatching` unifies the two lowercase sigmas the way Unicode
   * case folding does. This case goes red without that line.
   */
  it("matches every spelling of one Greek word, in both directions", () => {
    const spellings = ["ΟΔΟΣ", "οδος", "οδοσ"];
    for (const pattern of spellings) {
      for (const text of spellings) {
        const result = createRedactor(deterministicKey, { userPatterns: [pattern] })(
          `client ${text} here`,
        );
        expect(result.text, `${pattern} over ${text}`).toBe(
          "client [REDACTED:user-pattern] here",
        );
      }
    }
  });

  /**
   * And the limit that remains, which is correct rather than a gap: an accent is a
   * different letter, and nothing here folds it away.
   */
  it("does not match across an accent, because that is a different letter", () => {
    expect(
      createRedactor(deterministicKey, { userPatterns: ["Οδός"] })("client ΟΔΟΣ here")
        .text,
    ).toBe("client ΟΔΟΣ here");
  });

  it.each(["ΟΔΟΣ", "ΠΑΠΑΣ", "ΑΣ"])(
    "redacts %s, whose final sigma folds differently per character than whole-string",
    (pattern) => {
      expect(
        pattern.toLowerCase(),
        "the fixture needs the two foldings to disagree",
      ).not.toBe(perCharacterLower(pattern));

      const result = createRedactor(deterministicKey, { userPatterns: [pattern] })(
        `client ${pattern} here`,
      );
      expect(result.text).toBe("client [REDACTED:user-pattern] here");
    },
  );

  /**
   * De-duplication is on the folded needle, so two spellings of one name are one scan.
   * Asserted on a **case variant** rather than a byte-identical repeat: `addCandidate`
   * refuses an overlap either way, so a byte-identical pair produces one finding with or
   * without the dedupe and pins nothing.
   */
  it("treats two case spellings of one pattern as one needle", () => {
    const result = createRedactor(deterministicKey, {
      userPatterns: ["Acme Corp", "acme corp", "ACME CORP"],
    })("hello Acme Corp bye");
    expect(result.text).toBe("hello [REDACTED:user-pattern] bye");
    expect(result.findings.filter((f) => f.class === "user-pattern")).toHaveLength(1);
  });

  /**
   * **What longest-first does not close**, asserted so nobody reads the ordering as a
   * guarantee it is not. Two patterns that interleave rather than contain cannot both
   * win under `addCandidate`'s first-wins rule. Not a regression — the unordered scan
   * leaked here too — and registered as `BACKLOG.md` §1 **NEW-25**.
   */
  it("leaves the tail of a partially overlapping pattern, which ordering cannot fix", () => {
    const result = createRedactor(deterministicKey, {
      userPatterns: ["Acme Corp", "Corp Holdings"],
    })("x Acme Corp Holdings y");
    expect(result.text).toBe("x Acme [REDACTED:user-pattern] y");
  });

  it("still refuses a key shorter than the floor redactText enforces", () => {
    expect(() => createRedactor(new Uint8Array(31))("anything")).toThrow(RangeError);
  });
});
