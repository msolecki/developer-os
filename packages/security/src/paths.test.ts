import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT_CODES } from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertDisjointPaths,
  canonicalizePlannedPath,
} from "./paths.js";

const temporaryDirectories = new Set<string>();

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "developer-os-security-paths-"),
  );
  temporaryDirectories.add(directory);
  return directory;
}

afterEach(async () => {
  const exactDirectories = [...temporaryDirectories];
  temporaryDirectories.clear();
  await Promise.all(
    exactDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("canonicalizePlannedPath", () => {
  it("canonicalizes an existing directory", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const existingDirectory = join(temporaryDirectory, "existing-alpha");
    await mkdir(existingDirectory);

    await expect(canonicalizePlannedPath(existingDirectory)).resolves.toBe(
      await realpath(existingDirectory),
    );
  });

  it("canonicalizes missing descendants through their nearest existing ancestor", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const existingDirectory = join(temporaryDirectory, "existing-beta");
    await mkdir(existingDirectory);
    const canonicalExistingDirectory = await realpath(existingDirectory);

    await expect(
      canonicalizePlannedPath(
        join(existingDirectory, "planned-child", "planned-grandchild"),
      ),
    ).resolves.toBe(
      join(canonicalExistingDirectory, "planned-child", "planned-grandchild"),
    );
  });

  it.each(["relative/planned", "/tmp/synthetic\0planned"])(
    "rejects unsafe planned path %j with a security refusal",
    async (plannedPath) => {
      await expect(canonicalizePlannedPath(plannedPath)).rejects.toMatchObject({
        code: EXIT_CODES.securityRefusal,
      });
    },
  );
});

describe("assertDisjointPaths", () => {
  it("accepts two disjoint directories", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const first = join(temporaryDirectory, "knowledge-alpha");
    const second = join(temporaryDirectory, "product-beta");
    await Promise.all([mkdir(first), mkdir(second)]);

    await expect(assertDisjointPaths([first, second])).resolves.toBeUndefined();
  });

  it("rejects the same path", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const path = join(temporaryDirectory, "same-gamma");
    await mkdir(path);

    await expect(assertDisjointPaths([path, path])).rejects.toMatchObject({
      code: EXIT_CODES.securityRefusal,
    });
  });

  it("rejects a knowledge directory contained by a product directory", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const product = join(temporaryDirectory, "product-delta");
    const knowledge = join(product, "knowledge-epsilon");
    await mkdir(knowledge, { recursive: true });

    await expect(
      assertDisjointPaths([product, knowledge]),
    ).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
  });

  it("rejects a product directory contained by a knowledge directory", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const knowledge = join(temporaryDirectory, "knowledge-zeta");
    const product = join(knowledge, "product-eta");
    await mkdir(product, { recursive: true });

    await expect(
      assertDisjointPaths([knowledge, product]),
    ).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
  });

  it("does not confuse sibling names that merely share a prefix", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const first = join(temporaryDirectory, "brain");
    const second = join(temporaryDirectory, "brain-old");
    await Promise.all([mkdir(first), mkdir(second)]);

    await expect(assertDisjointPaths([first, second])).resolves.toBeUndefined();
  });
});
