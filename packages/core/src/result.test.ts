import { describe, expect, it } from "vitest";

import { EXIT_CODES, failure, formatJsonResult, success } from "./result.js";

describe("CLI result contracts", () => {
  it("pins every public exit code", () => {
    expect(EXIT_CODES).toEqual({
      success: 0,
      operationalFailure: 1,
      invalidInput: 2,
      decisionRequired: 3,
      capabilityUnavailable: 4,
      securityRefusal: 5,
      recoveryRequired: 6,
    });
  });

  it("formats successful results as deterministic JSON bytes", () => {
    const result = success({ version: "0.0.0" });

    expect(formatJsonResult(result)).toBe(
      '{"ok":true,"code":0,"data":{"version":"0.0.0"},"warnings":[]}',
    );
  });

  it("preserves warning order in successful JSON", () => {
    const result = success({ version: "0.0.0" }, ["first", "second"]);

    expect(formatJsonResult(result)).toBe(
      '{"ok":true,"code":0,"data":{"version":"0.0.0"},"warnings":["first","second"]}',
    );
  });

  it("formats a redacted security refusal without success-only fields", () => {
    const result = failure(EXIT_CODES.securityRefusal, {
      kind: "security_refusal",
      message: "Operation refused",
      paths: ["<redacted>"],
      recovery: "developer-os doctor",
    });

    expect(formatJsonResult(result)).toBe(
      '{"ok":false,"code":5,"error":{"kind":"security_refusal","message":"Operation refused","paths":["<redacted>"],"recovery":"developer-os doctor"}}',
    );
  });
});
