import {
  assertSafeCommand,
  NodeProcessRunner,
  redactText,
} from "@developer-os/security";
import { runBrain } from "@developer-os/cli/dist/commands/brain.js";
import { runCapture } from "@developer-os/cli/dist/commands/capture.js";
import { runDoctor } from "@developer-os/cli/dist/commands/doctor.js";
import { runReview } from "@developer-os/cli/dist/commands/review.js";
import { runStatus } from "@developer-os/cli/dist/commands/status.js";

import { afterEach, describe, expect, it } from "vitest";

import {
  CLAUDE,
  clearCalls,
  installSecurityFixture,
  isDiscoveryOrVersionProbe,
  isVersionProbe,
  nothingProposed,
  oneNote,
  removeSecurityFixtures,
} from "./helpers.js";
import type { InstalledFixture, VendorCall } from "./helpers.js";

/**
 * **`BACKLOG.md` §7's standing gate, and the reason it matters here more than
 * anywhere before: this subsystem is the first thing in the program that makes
 * an outbound process call.** Spec §2.7 is the property — nothing reaches a
 * network except the vendor's own agent CLI, through `packages/security`'s
 * runner, during ingest.
 *
 * **The spawn list is classified, not forbidden.** `doctor`, `status` and
 * `capture` all spawn locally: `MacOsPlatformAdapter.discoverExecutable` runs
 * `/usr/bin/which`, and `discoverCli` runs `<exe> --version`. A `which` is not a
 * network call, so asserting an empty spawn list would be asserting something
 * false. What is asserted instead is that the classification is **total in both
 * directions**: the unclassified set is empty, and for every command that spawns
 * at all the classified set is not. A filter with nothing behind it passes by
 * filtering everything.
 *
 * **Every count below was measured against this tree, not copied from a plan.**
 * Two of them differ from the numbers Task 15's brief predicted, and the
 * difference is real rather than a fixture artefact:
 *
 * - **`doctor` is eight, not four.** `discoverEachAgent` is called three times
 *   per run — once for the Claude capability reporter (`doctor.ts:410`), once
 *   for the Codex one (`:462`), once for the `agents` check (`:775`) — so six
 *   `which` calls, plus one `--version` per installed vendor.
 * - **`capture` is two when an agent is detected and zero when one is not.**
 *   `discoverSourceAgent` does both halves: `discoverExecutable`, then a version
 *   probe through the runner. **Both rows are now reachable, and which one you
 *   get depends on the vendor:** since Task 17 (2026-08-15)
 *   `AGENT_DETECTION_ROWS` carries Claude's row, so a capture inside a Claude
 *   Code session takes the two-call path, while one inside a Codex session
 *   still takes the zero-call path because that vendor's row could not be
 *   observed.
 */

/**
 * What the vendor's child process is handed. Both adapters pass `env: {}`
 * (`packages/adapter-claude/src/invoke.ts:125`,
 * `packages/adapter-codex/src/invoke.ts:251`), so this is empty today.
 *
 * Declared as an expectation rather than written as `toEqual({})` inline: an
 * empty environment is stricter than spec §2.7 asks and this constant is where a
 * vendor CLI that genuinely needs `HOME` would be admitted, deliberately, in one
 * place a reviewer can see.
 */
const EXPECTED_VENDOR_ENVIRONMENT: Readonly<Record<string, string>> = {};

const PROXY = "http://proxy.invalid:8080";

interface CommandCase {
  readonly label: string;
  readonly localSpawns: number;
  readonly run: (fixture: InstalledFixture) => Promise<unknown>;
}

const COMMANDS: readonly CommandCase[] = [
  {
    label: "capture, with no agent detected",
    localSpawns: 0,
    run: (fixture) =>
      runCapture(
        fixture.context,
        { text: "an observation with no agent" },
        { cwd: () => fixture.project, detect: () => "unknown" },
      ),
  },
  {
    label: "capture, with an agent detected",
    localSpawns: 2,
    run: (fixture) =>
      runCapture(
        fixture.context,
        { text: "an observation with an agent" },
        { cwd: () => fixture.project, detect: () => "claude" },
      ),
  },
  {
    label: "review",
    localSpawns: 0,
    run: (fixture) => runReview(fixture.context, {}),
  },
  {
    label: "brain reindex",
    localSpawns: 0,
    run: (fixture) =>
      runBrain(fixture.context, {
        subcommand: "reindex",
        query: null,
        limit: null,
        dryRun: false,
      }),
  },
  {
    label: "brain search x",
    localSpawns: 0,
    run: (fixture) =>
      runBrain(fixture.context, {
        subcommand: "search",
        query: "x",
        limit: null,
        dryRun: false,
      }),
  },
  {
    /**
     * **Eight pins the triple discovery, deliberately.** `discoverEachAgent` is
     * called three times per run — `doctor.ts:410` for the Claude capability
     * reporter, `:462` for the Codex one, `:775` for the `agents` check — which
     * is six `which` calls plus one `--version` per installed vendor. The task
     * report carries that as a memoization opportunity, so whoever takes it
     * should know **this row reddens with the fix**: memoizing discovery makes
     * the count four, and this number is the place to change.
     */
    label: "doctor",
    localSpawns: 8,
    run: (fixture) => runDoctor(fixture.context),
  },
  {
    label: "status",
    localSpawns: 2,
    run: (fixture) => runStatus(fixture.context),
  },
];

afterEach(removeSecurityFixtures);

describe("no command reaches a network", () => {
  it.each(COMMANDS)("makes no outbound call at all during $label", async (command) => {
    /**
     * The real platform adapter over the recording runner, so `/usr/bin/which`
     * is a request this suite can see. A fake adapter would answer discovery
     * from a table and the spawn it hides is exactly the one being classified.
     */
    const fixture = await installSecurityFixture(
      `network-${command.label.replace(/\W+/gu, "-")}`,
      { platform: "real" },
    );
    clearCalls(fixture.runner);

    await command.run(fixture);

    const { calls } = fixture.runner;
    const local = calls.filter(isDiscoveryOrVersionProbe);
    /** Total in one direction: nothing this run spawned is unclassified. */
    expect(calls.filter((call) => !isDiscoveryOrVersionProbe(call))).toStrictEqual([]);
    /** And total in the other: the count is named, never merely non-negative. */
    expect(local).toHaveLength(command.localSpawns);

    if (command.localSpawns === 0) {
      expect(calls).toStrictEqual([]);
      return;
    }
    /** A classified set with nothing in it would satisfy the filter above. */
    expect(local.length).toBeGreaterThan(0);
    for (const call of local) {
      expect(call.executable.startsWith("/")).toBe(true);
      expect(call.args.join(" ")).not.toContain("://");
    }
  });
});

describe("the one outbound call this product makes", () => {
  it("spawns exactly one process during ingest, and it is the discovered vendor binary", async () => {
    const fixture = await installSecurityFixture("network-ingest");
    const seeded = await fixture.seedAccepted("an observation for the vendor");
    fixture.runner.reply(() => oneNote(seeded.id, "DEV/network.md"));

    await fixture.ingest();

    const spawned = fixture.runner.calls.filter((call) => !isVersionProbe(call));
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.executable).toBe(CLAUDE);
    expect(spawned[0]?.env).toStrictEqual(EXPECTED_VENDOR_ENVIRONMENT);
  });

  /**
   * **The inheritance path, which an equality against a declared expectation can
   * never fail on.** If the runner leaked the parent environment,
   * `EXPECTED_VENDOR_ENVIRONMENT` above would simply have been written to
   * include it and the case would have been "fixed" by editing the expectation —
   * the failure mode `SESSION.md` names as encoding a bug.
   *
   * **The non-empty assertion is on the parent, not the child**, and that is the
   * one place this case departs from the shape the brief sketched. The child's
   * environment is empty *by design* (`env: {}` at both adapters), so asserting
   * `Object.keys(child.env).length > 0` would pin a property this product does
   * not have and could only be made green by weakening the product. The rule
   * that a sweep must be non-empty per scope is honoured on the scope that must
   * be non-empty: the environment the run was made under really did carry both
   * proxies.
   */
  it("does not pass a proxy the parent process was given", async () => {
    const before = {
      HTTP_PROXY: process.env["HTTP_PROXY"],
      HTTPS_PROXY: process.env["HTTPS_PROXY"],
    };
    process.env["HTTP_PROXY"] = PROXY;
    process.env["HTTPS_PROXY"] = PROXY;

    try {
      const fixture = await installSecurityFixture("network-proxy", {
        env: { HTTP_PROXY: PROXY, HTTPS_PROXY: PROXY },
      });
      await fixture.seedAccepted("an observation behind a proxy");
      fixture.runner.reply(() => nothingProposed());

      await fixture.ingest();

      const spawned = fixture.runner.calls.filter((call) => !isVersionProbe(call));
      expect(spawned).toHaveLength(1);
      const child = spawned[0] as VendorCall;
      expect(Object.keys(child.env)).not.toContain("HTTP_PROXY");
      expect(Object.keys(child.env)).not.toContain("HTTPS_PROXY");

      /** The parent really did carry them, in both channels the CLI can read. */
      expect(Object.keys(process.env)).toContain("HTTP_PROXY");
      expect(Object.keys(fixture.context.env)).toContain("HTTPS_PROXY");
    } finally {
      restore("HTTP_PROXY", before.HTTP_PROXY);
      restore("HTTPS_PROXY", before.HTTPS_PROXY);
    }
  });

  /**
   * The same property against the **real** runner rather than the recording one,
   * because `NodeProcessRunner` is where a leak would actually happen: it spawns
   * with `env: { ...request.env }`, and Node inherits nothing when `env` is
   * given. `/usr/bin/env` is a local system binary that prints the environment
   * it was handed — no vendor binary is spawned anywhere in this directory.
   */
  it("hands a real child only the environment the request declared", async () => {
    const before = process.env["HTTP_PROXY"];
    process.env["HTTP_PROXY"] = PROXY;

    try {
      const runner = new NodeProcessRunner({
        assertCommand: assertSafeCommand,
        redact: (text: string) => redactText(text, new Uint8Array(32).fill(3)),
      });
      const request = {
        executable: "/usr/bin/env",
        args: [] as readonly string[],
        cwd: "/",
        stdin: "",
        timeoutMs: 10_000,
      };

      /** The positive control: this binary does report what it is handed. */
      const declared = await runner.run({
        ...request,
        env: { DEVELOPER_OS_PROBE: "declared" },
      });
      expect(declared.stdout).toContain("DEVELOPER_OS_PROBE=declared");

      const empty = await runner.run({ ...request, env: {} });
      expect(empty.stdout).not.toContain("HTTP_PROXY");
      expect(empty.stdout.trim()).toBe("");
    } finally {
      restore("HTTP_PROXY", before);
    }
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }
  process.env[name] = value;
}
