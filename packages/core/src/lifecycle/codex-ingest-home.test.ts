import { describe, expect, it } from "vitest";

import { inspectCodexIngestHomeShape } from "./codex-ingest-home.js";

const UID = 501;
const DIR = { kind: "directory", ownerUid: UID, mode: 0o700 } as const;
const LINK = { kind: "symlink", ownerUid: UID, mode: 0o755 } as const;

describe("inspectCodexIngestHomeShape (D52)", () => {
  it("admits an empty owned 0700 directory and one with only the auth.json symlink", () => {
    expect(inspectCodexIngestHomeShape(DIR, [], () => null, UID)).toEqual({ admitted: true });
    expect(inspectCodexIngestHomeShape(DIR, ["auth.json"], () => LINK, UID)).toEqual({ admitted: true });
  });

  it("refuses the directory itself when it is not an owned 0700 directory", () => {
    for (const directory of [null, { ...DIR, mode: 0o755 }, { ...DIR, ownerUid: UID + 1 }, { ...LINK }]) {
      expect(inspectCodexIngestHomeShape(directory, [], () => null, UID)).toEqual({ admitted: false, offendingName: null });
    }
  });

  it("refuses any vendor instruction surface or residue, and a credential that is not a link", () => {
    for (const name of ["AGENTS.md", "agents", "plugins", "config.toml", "state_5.sqlite"]) {
      expect(inspectCodexIngestHomeShape(DIR, [name], () => LINK, UID)).toEqual({ admitted: false, offendingName: name });
    }
    const regular = { kind: "regular_file", ownerUid: UID, mode: 0o600 };
    expect(inspectCodexIngestHomeShape(DIR, ["auth.json"], () => regular, UID)).toEqual({
      admitted: false,
      offendingName: "auth.json",
    });
  });
});
