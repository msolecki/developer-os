import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runtimePathsFor } from "../context.js";
import { readConfigFile } from "./doctor.js";
import { runInit } from "./init.js";
import {
  fingerprintDirectory,
  resolveQuarantine,
  writeQuarantineCapture,
} from "./quarantine.js";
import { createCommandFixture, removeCommandFixtures } from "./testing.js";
import type { CommandFixture } from "./testing.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

/** A real installation from the real `init`, as `capture.test.ts` builds one. */
async function installed(label: string): Promise<CommandFixture> {
  const fixture = await createCommandFixture(label);
  const result = await runInit(fixture.context, ACCEPTED);
  expect(result.ok, "the fixture must install first").toBe(true);
  return fixture;
}

async function rootsOf(fixture: CommandFixture) {
  const config = await readConfigFile(fixture.context, fixture.context.paths.configFile);
  expect(config, "init writes a configuration").not.toBeNull();
  if (config === null) throw new Error("unreachable");
  return { config, paths: runtimePathsFor(fixture.context, config) };
}

class SyntheticRefusal extends Error {
  constructor(
    message: string,
    readonly paths: readonly string[],
  ) {
    super(message);
  }
}

const refuse = (message: string, paths: readonly string[]): Error =>
  new SyntheticRefusal(message, paths);

describe("fingerprintDirectory", () => {
  const first = new Uint8Array(32).fill(1);
  const second = new Uint8Array(32).fill(2);

  it("is 16 lowercase hex characters, stable for one key and different for another", () => {
    const fingerprint = fingerprintDirectory("/synthetic/project", first);

    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/u);
    expect(fingerprintDirectory("/synthetic/project", first)).toBe(fingerprint);
    expect(fingerprintDirectory("/synthetic/project", second)).not.toBe(fingerprint);
  });
});

describe("resolveQuarantine", () => {
  it("refuses through refuse when quarantine is a symlink out of the content root", async () => {
    const fixture = await installed("quarantine-relocated");
    const { config, paths } = await rootsOf(fixture);
    const { quarantine } = await resolveQuarantine(fixture.context, config, paths, refuse);

    const elsewhere = join(fixture.root, "elsewhere");
    await nodeFs.mkdir(elsewhere, { recursive: true, mode: 0o700 });
    await nodeFs.rm(quarantine, { recursive: true, force: true });
    await nodeFs.symlink(elsewhere, quarantine);

    const refused = await resolveQuarantine(fixture.context, config, paths, refuse).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refused).toBeInstanceOf(SyntheticRefusal);
    expect((refused as SyntheticRefusal).paths).toEqual([quarantine]);
  });
});

describe("writeQuarantineCapture", () => {
  it("writes one journal of the given kind that creates the target at 0600 or tighter", async () => {
    const fixture = await installed("quarantine-import-write");
    const { config, paths } = await rootsOf(fixture);
    const { quarantine } = await resolveQuarantine(fixture.context, config, paths, refuse);
    const target = join(quarantine, "0123456789abcdef.md");

    const id = await writeQuarantineCapture(
      fixture.context,
      paths,
      quarantine,
      target,
      "synthetic capture contents\n",
      "import",
    );

    const journal = await fixture.context.transactions.read(id);
    expect(journal.id).toBe(id);
    expect(journal.kind).toBe("import");
    expect(journal.mutations).toHaveLength(1);
    expect(journal.mutations[0]?.operation).toBe("create");
    expect(journal.mutations[0]?.targetPath).toBe(await nodeFs.realpath(target));

    const mode = (await nodeFs.stat(target)).mode & 0o777;
    expect(mode & 0o177).toBe(0);
  });
});
