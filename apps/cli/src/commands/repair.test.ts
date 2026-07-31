import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";

import { runInit } from "./init.js";
import { runRepair } from "./repair.js";
import {
  createCommandFixture,
  exists,
  removeCommandFixtures,
} from "./testing.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const INTERRUPTED_ID = "tx_fixture_001";

afterEach(removeCommandFixtures);

describe("runRepair", () => {
  it("refuses when neither action is named", async () => {
    const fixture = await createCommandFixture("repair-neither");

    const result = await runRepair(fixture.context, {
      resume: null,
      rollback: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
  });

  it("refuses when both actions are named", async () => {
    const fixture = await createCommandFixture("repair-both");

    const result = await runRepair(fixture.context, {
      resume: INTERRUPTED_ID,
      rollback: INTERRUPTED_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
  });

  it("refuses an identifier that is not a journal identifier", async () => {
    const fixture = await createCommandFixture("repair-shape");

    const result = await runRepair(fixture.context, {
      resume: "../../etc/passwd",
      rollback: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
  });

  it("refuses an identifier no journal uses", async () => {
    const fixture = await createCommandFixture("repair-unknown");

    const result = await runRepair(fixture.context, {
      resume: "tx_fixture_404",
      rollback: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
  });

  it("refuses a transaction that already finalized", async () => {
    const fixture = await createCommandFixture("repair-finalized");
    await runInit(fixture.context, ACCEPTED);

    const result = await runRepair(fixture.context, {
      resume: INTERRUPTED_ID,
      rollback: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(result.error.message).toContain("finalized");
  });

  it("resumes an interrupted transaction to completion", async () => {
    const fixture = await createCommandFixture("repair-resume", {
      interruptAfter: "staged",
    });
    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);
    expect(await exists(fixture.paths.configFile)).toBe(false);

    const result = await runRepair(fixture.context, {
      resume: INTERRUPTED_ID,
      rollback: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.action).toBe("resumed");
    expect(result.data.phase).toBe("finalized");
    expect(await exists(fixture.paths.configFile)).toBe(true);
  });

  it("rolls an interrupted transaction back to its original state", async () => {
    const fixture = await createCommandFixture("repair-rollback", {
      interruptAfter: "applied",
    });
    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);
    expect(await exists(fixture.paths.configFile)).toBe(true);

    const result = await runRepair(fixture.context, {
      resume: null,
      rollback: INTERRUPTED_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.action).toBe("rolled_back");
    expect(result.data.phase).toBe("rolled_back");
    expect(await exists(fixture.paths.configFile)).toBe(false);
  });
});
