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

function toLowerCaseCalls(run: () => void): number {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- restored below; only ever invoked with an explicit `this`
  const original = String.prototype.toLowerCase;
  let calls = 0;
  try {
    String.prototype.toLowerCase = function toLowerCase(this: string) {
      calls += 1;
      return original.call(this);
    };
    run();
  } finally {
    String.prototype.toLowerCase = original;
  }
  return calls;
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

  /** NEW-129: Brain note paths, slugs and wikilinks are not secrets. */
  describe("note paths and slugs", () => {
    const slug = "developer-os-release-handoff-review-fixes-quickly-jumping-zebras";
    const benign = [
      slug,
      `[[DEV/${slug}]]`,
      `content/DEV/${slug}.md`,
      "content/DEV/check-trust-at-every-symlink-hop.md",
      "[[DEV/what-must-live-in-the-durable-journal]]",
      "_raw/processed/2026-07-16-143736-48639-przedsiebiorcze-trojmiasto.md",
      "docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md",
      "packages/core/src/lifecycle/foundation-ledger.ts:911",
    ];
    for (const value of benign) {
      it(`leaves ${value} in the clear`, () => {
        const result = redactText(`see ${value} for details`, deterministicKey);

        expect(result.text).toBe(`see ${value} for details`);
        expect(result.findings).toEqual([]);
      });
    }

    const pathEmbeddedToken = "Qm4Zx9Tp2Lk7Wr5Vn8Bc3Hy6Jd1Fs0Ga4Ue7Io9Pz2K"; // gitleaks:allow -- synthetic test fixture
    const slashedBase64 = "aZ3+kQ9/Xw7mP2+vL8/tR4nB6+yH1/cJ5sD0fG7=="; // gitleaks:allow -- synthetic test fixture
    const hyphenatedRandom = "k3m9x2p7q4-z8w1v6b3n5-r2t7y4u9i0-h5g8f1d3s6-a9l2"; // gitleaks:allow -- synthetic test fixture
    const secrets = {
      "a mixed-case base64 token": highEntropySecret,
      "a hex digest": lowercaseHexSecret,
      "a lowercase alphanumeric token": lowercaseAlphanumericSecret,
      "a base64 token containing / and +": slashedBase64,
      "a token embedded as one path segment": `config/${pathEmbeddedToken}/x`,
      "a hyphen-joined random token": hyphenatedRandom,
      /** Review of NEW-129: the exemption is bounded in part count and part length. */
      "thirteen random word-like chunks": "qazu-wexi-rymo-tupa-kelo-jivu-fyze-gowa-bidu-nesy-hoke-lamu-cyvo", // gitleaks:allow -- synthetic test fixture
      "a random letter chunk longer than a word": "zqvbeytrwkxmolpfn-hazdusi-gerwopyk-lemtovaq", // gitleaks:allow -- synthetic test fixture
    };
    for (const [name, secret] of Object.entries(secrets)) {
      it(`still redacts ${name}`, () => {
        const result = redactText(`value ${secret} end`, deterministicKey);

        expect(result.text).not.toContain(secret);
        expect(result.findings.map((f) => f.class)).toContain("high-entropy");
      });
    }

    /** An all-word passphrase is exempt from high-entropy, so its label has to catch it. */
    const passphrase = "lantern-quiver-mosaic-bramble-oyster-plinth-tundra"; // gitleaks:allow -- synthetic test fixture
    for (const line of [
      `the vault passphrase is ${passphrase}`,
      `mnemonic: ${passphrase}`,
      `recovery key = ${passphrase}`,
    ]) {
      it(`redacts a labelled passphrase: ${line.replace(passphrase, "<words>")}`, () => {
        const result = redactText(line, deterministicKey);

        expect(result.text).not.toContain(passphrase);
        expect(result.findings.map((f) => f.class)).toEqual(["credential-store"]);
      });
    }

    it("leaves the same words in prose without a label", () => {
      const line = `see ${passphrase} for details`;
      expect(redactText(line, deterministicKey).text).toBe(line);
    });
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

  /**
   * NEW-25: first-wins dropped a partially overlapping candidate whole, leaving its
   * non-overlapping part in the clear. Merged ranges keep the class of the earliest
   * scanned contributor and fingerprint the whole merged span. `high-entropy` stays
   * first-wins (D71).
   */
  describe("merging partially overlapping ranges across classes", () => {
    const fingerprintOf = (secret: string): string =>
      createHmac("sha256", deterministicKey).update(secret).digest("hex").slice(0, 16);

    it("extends a provider token over a user pattern that overlaps its tail", () => {
      const { text, findings } = redactText(
        `key ${providerToken} tail end`,
        deterministicKey,
        { userPatterns: ["a1a1 tail"] },
      );

      expect(text).toBe("key [REDACTED:provider-token] end");
      expect(findings).toEqual([
        { class: "provider-token", fingerprint: fingerprintOf(`${providerToken} tail`) },
      ]);
    });

    it("extends a service credential over a user pattern that overlaps its head", () => {
      const { text, findings } = redactText(
        `id ${awsAccessKeyId} here`,
        deterministicKey,
        { userPatterns: ["id akia"] },
      );

      expect(text).toBe("[REDACTED:service-credential] here");
      expect(findings).toEqual([
        { class: "service-credential", fingerprint: fingerprintOf(`id ${awsAccessKeyId}`) },
      ]);
    });

    it("joins two disjoint findings of different classes that a later pattern bridges", () => {
      const source = `${providerToken} ${awsAccessKeyId} tail`;
      const { text, findings } = redactText(source, deterministicKey, {
        userPatterns: ["a1 akia"],
      });

      expect(text).toBe("[REDACTED:provider-token] tail");
      expect(findings).toEqual([
        {
          class: "provider-token",
          fingerprint: fingerprintOf(`${providerToken} ${awsAccessKeyId}`),
        },
      ]);
    });

    /** D71: a whole `KEY=value` line is high-entropy-shaped; merging it would change this fingerprint. */
    it("does not merge a high-entropy run into an env secret, keeping key name and fingerprint", () => {
      const { text, findings } = redactText(`API_TOKEN=${environmentSecret}`, deterministicKey);

      expect(text).toBe("API_TOKEN=[REDACTED:env-secret]");
      expect(findings).toEqual([
        { class: "env-secret", fingerprint: fingerprintOf(environmentSecret) },
      ]);
    });

    /** D71 residual, pinned so it is not mistaken for coverage. */
    it("drops a high-entropy run that partially overlaps an earlier candidate, leaving its tail", () => {
      const { text, findings } = redactText(`opaque ${highEntropySecret}`, deterministicKey, {
        userPatterns: [highEntropySecret.slice(0, 6)],
      });

      expect(text).toBe(`opaque [REDACTED:user-pattern]${highEntropySecret.slice(6)}`);
      expect(findings.map((f) => f.class)).toEqual(["user-pattern"]);
    });

    it("keeps touching but non-overlapping ranges as separate findings", () => {
      const { text, findings } = redactText("x acmecorp y", deterministicKey, {
        userPatterns: ["acme", "corp"],
      });

      expect(text).toBe("x [REDACTED:user-pattern][REDACTED:user-pattern] y");
      expect(findings).toHaveLength(2);
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
     * Finding 10 (fix pass 1 review): the pattern is never compiled as a
     * regular expression. A compiled `(a+)+$` matches an all-`a` text and
     * would redact it; a literal one does not occur in it.
     */
    it("treats a pathological pattern as literal text over a long input", () => {
      const source = "a".repeat(50_000);
      const result = redactText(source, deterministicKey, {
        userPatterns: ["(a+)+$"],
      });

      expect(result.text).toBe(source);
      expect(result.findings).toHaveLength(0);
    });

    /**
     * Important 5 (fix pass 1 review), NEW-29: the first shipped implementation
     * re-sliced and re-lowered a window at every text position for every
     * pattern — O(n·m) per pattern. Counted through `toLowerCase`, which
     * `foldForMatching` calls once per code point: folding the haystack once
     * makes each extra pattern cost its own length, a per-position rescan makes
     * it cost the text's.
     */
    it("folds the text once, whatever the pattern count, not once per pattern per position", () => {
      const text = "x".repeat(4096);
      const patterns = Array.from(
        { length: 10 },
        (_, index) => `pattern-${String(index)}-not-present-in-text-xyz`,
      );

      const baseline = toLowerCaseCalls(() =>
        redactText(text, deterministicKey, { userPatterns: patterns.slice(0, 1) }),
      );
      const withPatterns = toLowerCaseCalls(() =>
        redactText(text, deterministicKey, { userPatterns: patterns }),
      );

      expect(baseline).toBeGreaterThanOrEqual(text.length);
      expect(withPatterns - baseline).toBeLessThan(text.length);
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
     * NEW-29: the bound is asserted as behavior, not as elapsed time — a body
     * far past it is not matched, which an unbounded rescan would match.
     */
    it.each(["CERTIFICATE", "PRIVATE KEY"])(
      "bounds the %s body rescanned per BEGIN marker",
      (label) => {
        const block = (body: string): string =>
          `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
        const realistic = block("A".repeat(4_000));
        const oversized = block("A".repeat(100_000));

        expect(redactText(realistic, deterministicKey).findings).toHaveLength(1);
        expect(redactText(oversized, deterministicKey).text).toContain(`-----BEGIN ${label}-----`);
      },
    );
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
   * `addCandidate` was first-wins on overlap, so an unordered scan made the result depend
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
   * merges an overlap either way, so a byte-identical pair produces one finding with or
   * without the dedupe and pins nothing.
   */
  it("treats two case spellings of one pattern as one needle", () => {
    const result = createRedactor(deterministicKey, {
      userPatterns: ["Acme Corp", "acme corp", "ACME CORP"],
    })("hello Acme Corp bye");
    expect(result.text).toBe("hello [REDACTED:user-pattern] bye");
    expect(result.findings.filter((f) => f.class === "user-pattern")).toHaveLength(1);
  });

  /** NEW-25: under first-wins, `"Acme "` stayed in the clear here. */
  it("merges two partially overlapping patterns into one redaction", () => {
    const result = createRedactor(deterministicKey, {
      userPatterns: ["Acme Corp", "Corp Holdings"],
    })("x Acme Corp Holdings y");
    expect(result.text).toBe("x [REDACTED:user-pattern] y");
    expect(result.findings.map((f) => f.class)).toEqual(["user-pattern"]);
  });

  it("still refuses a key shorter than the floor redactText enforces", () => {
    expect(() => createRedactor(new Uint8Array(31))("anything")).toThrow(RangeError);
  });
});

describe("redaction scopes (NEW-36, NEW-39)", () => {
  const redact = createRedactor(deterministicKey, { userPatterns: ["Acme Corp"] });
  const quarantinePath = "/tmp/developer-os-a1b2c3d4e5f6a7b8/_raw/quarantine/a1b2c3d4e5f60718.md";
  const decomposed = "DEV/Café.md";

  it("keeps the bytes of an NFD path with nothing to redact", () => {
    const result = redact(decomposed, "path");

    expect(result.text).toBe(decomposed);
    expect(result.findings).toStrictEqual([]);
  });

  it("still returns NFC in the default text scope", () => {
    expect(redact(decomposed).text).toBe(decomposed.normalize("NFC"));
  });

  it("keeps the bytes of an NFD string leaf in the value scope", () => {
    expect(redact(decomposed, "value").text).toBe(decomposed);
  });

  it("does not apply high-entropy to a path", () => {
    const path = `DEV/notes ${highEntropySecret}.md`;

    expect(redact(path, "path").text).toBe(path);
    expect(redact(path).text).toContain("[REDACTED:high-entropy]");
  });

  it("leaves a quarantine path intact but redacts a configured pattern in a path", () => {
    expect(redact(quarantinePath, "path").text).toBe(quarantinePath);
    expect(redact("DEV/Acme Corp notes.md", "path").text).toBe(
      "DEV/[REDACTED:user-pattern] notes.md",
    );
  });

  it("matches a configured pattern in a decomposed path", () => {
    const withAccent = createRedactor(deterministicKey, { userPatterns: ["Café"] });

    expect(withAccent(decomposed, "path").text).toBe("DEV/[REDACTED:user-pattern].md");
  });

  it("applies provider classes to a path", () => {
    expect(redact(`DEV/${providerToken}.md`, "path").text).toBe(
      "DEV/[REDACTED:provider-token].md",
    );
  });

  it("never applies a user pattern to a name, and still applies provider classes", () => {
    const names = createRedactor(deterministicKey, { userPatterns: ["captureId"] });

    expect(names("captureId", "name")).toStrictEqual({ text: "captureId", findings: [] });
    expect(names("captureId", "value").text).toBe("[REDACTED:user-pattern]");
    expect(names(providerToken, "name").text).toBe("[REDACTED:provider-token]");
  });

  it("redacts a matched value exactly as the text scope does", () => {
    const line = `MY_API_KEY=${environmentSecret}`;

    expect(redact(line).findings.length).toBeGreaterThan(0);
    expect(redact(line, "value")).toStrictEqual(redact(line));
  });
});

/**
 * NEW-24, founder decision D73: a persisted finding may carry the zero-based index of the
 * configured pattern that produced it, and an over-broad pattern is detected by the fraction
 * of the input its own matches cover — never by its length, which refused `EY` and every
 * two-character CJK name when it was tried.
 */
describe("user pattern index and match density (NEW-24, D73)", () => {
  /** 300 code units, hand-countable: every other one is an `a`, so `a` covers 50%. */
  const alternating = "ab".repeat(150);
  /** 300 code units carrying one four-character name: 4 / 300 is about 1.3%. */
  const oneMention = `Acme ${"x".repeat(295)}`;

  it("indexes a finding by the pattern's position as configured, not by scan order", () => {
    const { findings } = redactText("x Acme Corp Holdings y Acme z", deterministicKey, {
      userPatterns: ["Acme", "Acme Corp Holdings"],
    });

    expect(findings.map((f) => f.patternIndex)).toEqual([1, 0]);
  });

  it("indexes two spellings of one needle by the first one configured", () => {
    const { findings } = redactText("x ACME y", deterministicKey, {
      userPatterns: ["Northwind", "acme", "Acme"],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.patternIndex).toBe(1);
  });

  it("keeps the index of the longest contributor when two patterns merge", () => {
    const { findings } = redactText("x Acme Corp Holdings y", deterministicKey, {
      userPatterns: ["Acme Corp", "Corp Holdings"],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.patternIndex).toBe(1);
  });

  it("carries no index on a finding whose class is not user-pattern, even after a merge", () => {
    const { findings } = redactText(`key ${providerToken} tail end`, deterministicKey, {
      userPatterns: ["a1a1 tail"],
    });

    expect(findings.map((f) => f.class)).toEqual(["provider-token"]);
    expect(Object.keys(findings[0] ?? {})).toEqual(["class", "fingerprint"]);
  });

  it("flags a pattern whose matches cover much of the input", () => {
    const result = redactText(alternating, deterministicKey, {
      userPatterns: ["Acme", "a"],
    });

    expect(result.overBroadPatterns).toEqual([1]);
  });

  it("does not flag a name mentioned once in a longer text", () => {
    const result = redactText(oneMention, deterministicKey, { userPatterns: ["Acme"] });

    expect(result.findings).toHaveLength(1);
    expect(result.overBroadPatterns).toBeUndefined();
  });

  it("does not flag a short input that is nothing but the name", () => {
    const result = redactText("Acme Corp", deterministicKey, { userPatterns: ["Acme Corp"] });

    expect(result.findings).toHaveLength(1);
    expect(result.overBroadPatterns).toBeUndefined();
  });

  it("measures each pattern's own matches, so a long name lends a short one no coverage", () => {
    /** `Acme Corp Holdings` covers 54 / 300 = 18%; `Acme` alone covers 12 / 300 = 4%. */
    const text = `${"Acme Corp Holdings ".repeat(3)}${"y".repeat(243)}`;
    const result = redactText(text, deterministicKey, {
      userPatterns: ["Acme", "Acme Corp Holdings"],
    });

    expect(result.overBroadPatterns).toEqual([1]);
  });

  it("reports nothing over-broad in the name scope, which applies no user pattern", () => {
    const result = createRedactor(deterministicKey, { userPatterns: ["a"] })(alternating, "name");

    expect(result).toStrictEqual({ text: alternating, findings: [] });
  });

  it("leaves the result shape unchanged when no pattern is over-broad", () => {
    const result = redactText(oneMention, deterministicKey, { userPatterns: ["Acme"] });

    expect(Object.keys(result)).toEqual(["text", "findings"]);
  });
});
