import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
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

    it("keeps a JWT triplet as one service-credential finding despite an overlapping user pattern", () => {
      const { findings } = redactText(jwtTriplet, deterministicKey, {
        userPatterns: ["synthetic-user"],
      });

      expect(findings.map((f) => f.class)).toEqual(["service-credential"]);
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
     * Important 5 (fix pass 1 review): the first shipped implementation
     * re-sliced and re-lowered a window at every text position for every
     * pattern — O(n·m) per pattern. Measured before the fix: 2 MB of text
     * with 10 patterns took 533 ms; this pins a generous ceiling so a
     * regression back to that shape fails the suite rather than only
     * showing up as a slow `capture`.
     */
    it("scales to large text and several patterns without a per-position rescan", () => {
      const text = "x".repeat(2 * 1024 * 1024);
      const patterns = Array.from(
        { length: 10 },
        (_, index) => `pattern-${String(index)}-not-present-in-text-xyz`,
      );
      const started = performance.now();
      redactText(text, deterministicKey, { userPatterns: patterns });
      expect(performance.now() - started).toBeLessThan(1_000);
    });

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
