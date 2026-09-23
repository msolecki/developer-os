import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCanonicalAbsolutePathText, parseUInt64Decimal, SCHEDULED_JOB_IDS } from "@developer-os/core";
import type { HeldLifecycleStableLockV1 } from "@developer-os/core";
import { LAUNCHD_JOBS } from "@developer-os/platform-macos";

import { createCommandFixture, removeCommandFixtures } from "../testing.js";
import { createProductionScheduledHandlers } from "./handlers.js";

afterEach(removeCommandFixtures);

describe("the production scheduled handlers", () => {
  it("cover exactly the closed four-job registry, none of which may spawn a vendor", () => {
    expect(SCHEDULED_JOB_IDS.length).toBeGreaterThan(0);
    expect([...SCHEDULED_JOB_IDS]).toStrictEqual(["brain-reindex", "brain-lint", "doctor", "git-sync"]);
    expect(LAUNCHD_JOBS.map((job) => job.id)).toStrictEqual([...SCHEDULED_JOB_IDS]);
    expect(LAUNCHD_JOBS.map((job) => job.maySpawnVendor)).toStrictEqual([false, false, false, false]);
  });

  it("run git-sync through the Git sync, reporting a refusal by its own safe reason and releasing nothing", async () => {
    const fixture = await createCommandFixture("scheduled-git-sync");
    const lifecycle = fixture.context.lifecycle;
    if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
    const releases: string[] = [];
    const held: HeldLifecycleStableLockV1 = {
      path: parseCanonicalAbsolutePathText(join(fixture.paths.stateDir, ".lifecycle.lock")),
      dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal("1"),
      release: () => {
        releases.push("released");
        return Promise.resolve();
      },
    };

    const result = await createProductionScheduledHandlers(fixture.context, lifecycle).run("git-sync", held);

    expect(result).toMatchObject({ outcome: "handler_refused", reasonCode: "manifest_absent" });
    expect(releases).toStrictEqual([]);
  });
});
