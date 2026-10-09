import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const HEX = /^[0-9a-f]{64}$/u;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const hex = (): string => expect.stringMatching(HEX) as string;
const semver = (): string => expect.stringMatching(SEMVER) as string;

describe("release pins (A16 §2, §3.3, §5)", () => {
  it("pins the bundled Node to .node-version, Node 24, with both darwin archive hashes", async () => {
    const pins = JSON.parse(await readFile(join(root, ".github/release/pins.json"), "utf8")) as Record<string, Record<string, string>>;
    const nodeVersion = (await readFile(join(root, ".node-version"), "utf8")).trim();
    expect(Object.keys(pins).sort()).toEqual(["cdxgen", "gitleaks", "node"]);
    expect(pins.node).toEqual({ version: nodeVersion, "darwin-arm64": hex(), "darwin-x64": hex() });
    expect(nodeVersion).toMatch(/^24\.[0-9]+\.[0-9]+$/u);
    expect(pins.node?.["darwin-arm64"]).not.toBe(pins.node?.["darwin-x64"]);
    expect(pins.gitleaks).toEqual({ version: semver(), "darwin-arm64": hex() });
    expect(pins.cdxgen).toEqual({ version: semver() });
  });

  it("pins the root cdxgen devDependency to the same exact version as pins.json", async () => {
    const pins = JSON.parse(await readFile(join(root, ".github/release/pins.json"), "utf8")) as { cdxgen: { version: string } };
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
    expect(manifest.devDependencies["@cyclonedx/cdxgen"]).toBe(pins.cdxgen.version);
  });
});
