import { describe, expect, it } from "vitest";

import { parseVendorHomeVariables, VENDOR_HOME_VARIABLES, VendorHomeVariableError } from "./vendor-home-variables.js";

describe("parseVendorHomeVariables (NEW-208)", () => {
  it("names exactly CODEX_HOME and CLAUDE_CONFIG_DIR", () => {
    expect(VENDOR_HOME_VARIABLES).toStrictEqual(["CODEX_HOME", "CLAUDE_CONFIG_DIR"]);
  });

  it("passes valid values and omits absent or empty ones", () => {
    expect(parseVendorHomeVariables({ CODEX_HOME: "/x/codex", CLAUDE_CONFIG_DIR: "/x/claude" })).toStrictEqual({ CODEX_HOME: "/x/codex", CLAUDE_CONFIG_DIR: "/x/claude" });
    expect(parseVendorHomeVariables({ CODEX_HOME: "", CLAUDE_CONFIG_DIR: undefined })).toStrictEqual({});
  });

  it("throws naming the variable for a NUL-carrying, relative or non-canonical value", () => {
    for (const variable of VENDOR_HOME_VARIABLES) {
      for (const raw of ["/x/co\0dex", "relative/codex", "/x/../codex", "/x/codex/", "/x//codex", "/x/./codex"]) {
        expect(() => parseVendorHomeVariables({ [variable]: raw }), `${variable}=${raw}`).toThrow(expect.objectContaining({ variable }));
        expect(() => parseVendorHomeVariables({ [variable]: raw })).toThrow(VendorHomeVariableError);
      }
    }
  });
});
