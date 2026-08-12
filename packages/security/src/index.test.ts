import { describe, expect, it } from "vitest";
import * as door from "./index.js";

/**
 * Not an inventory — a door test. This package holds the guards two
 * adapters cross the vendor-CLI boundary through — `screenValueArgument`,
 * `parseStructuredPayload`, `discoverCli` among them — and a package with a
 * guarantee must not export the raw mechanism behind it alongside the guard:
 * two import paths for one rule is how a caller ends up depending on the
 * wrong one. The only way that stays true over time is a test that fails the
 * moment the surface widens, rather than one a reviewer has to remember to
 * compare by hand.
 *
 * Modelled on `packages/adapter-codex/src/index.test.ts`, which both adapters
 * already carry; `core`, `security` and `workflow-schema` — the three
 * packages both adapters now enter through — had no equivalent.
 */
describe("the package's public door", () => {
  it("exports exactly this list, and nothing else", () => {
    expect(Object.keys(door).sort()).toEqual(
      [
        "assertDisjointPaths",
        "canonicalizePlannedPath",
        "resolveOwnedPath",
        "SecurityRefusalError",
        "ProtectedPathPolicy",
        "redactText",
        "assertSafeCommand",
        "NodeProcessRunner",
        "discoverCli",
        "parseStructuredPayload",
        "screenValueArgument",
        "capGraphemes",
        "screenAndCap",
        "screenControlCharacters",
        "boundedProse",
        "fenced",
        "screenParagraphs",
      ].sort(),
    );
  });
});
