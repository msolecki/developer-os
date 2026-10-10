import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MacOsRetainedRenameRefusalError,
  SpawnRenameAtxRunner,
  type RenameAtxRunRequestV1,
} from "@developer-os/platform-macos";
import { describe, expect, it } from "vitest";

import { InProcessRenameAtxRunner } from "./testing.js";

const valid: RenameAtxRunRequestV1 = {
  sourceParentDescriptor: 3,
  destinationParentDescriptor: 4,
  sourceName: "x.json",
  destinationName: "x.json",
};

const refused: readonly (readonly [string, Partial<RenameAtxRunRequestV1>])[] = [
  ["a negative descriptor", { sourceParentDescriptor: -1 }],
  ["a fractional descriptor", { destinationParentDescriptor: 4.5 }],
  ["an empty name", { sourceName: "" }],
  ["a dot name", { destinationName: "." }],
  ["a dot-dot name", { sourceName: ".." }],
  ["a slash", { destinationName: "a/b" }],
  ["a space", { sourceName: "a b" }],
  ["a non-ASCII name", { destinationName: "zażółć" }],
  ["the same name in the same descriptor", { destinationParentDescriptor: 3 }],
];

describe("the fixture rename runner enforces the production runner's preconditions", () => {
  it.each(refused)("both runners refuse %s synchronously", (_label, change) => {
    const request = { ...valid, ...change };
    expect(() => new SpawnRenameAtxRunner().run(request)).toThrow(MacOsRetainedRenameRefusalError);
    expect(() => new InProcessRenameAtxRunner().run(request)).toThrow(MacOsRetainedRenameRefusalError);
  });

  it("moves a same-name file across two directories", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-rename-parity-"));
    const runner = new InProcessRenameAtxRunner();
    try {
      await nodeFs.mkdir(join(root, "a"));
      await nodeFs.mkdir(join(root, "b"));
      await nodeFs.writeFile(join(root, "a", "x.json"), "{}");
      runner.bind(3, join(root, "a"));
      runner.bind(4, join(root, "b"));
      await expect(runner.run(valid)).resolves.toStrictEqual({ exitCode: 0, signal: null });
      expect(await nodeFs.readFile(join(root, "b", "x.json"), "utf8")).toBe("{}");
    } finally {
      await nodeFs.rm(root, { recursive: true, force: true });
    }
  });
});
