import type { ExitCode } from "@developer-os/core";
import { EXIT_CODES } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import type { WorkflowTrigger } from "./contract.js";
import { workflowContractSchema } from "./contract.js";

function contract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "brain-search",
    version: "1.0.0",
    description: "Search the vault and return ranked matches.",
    triggers: ["manual"],
    inputs: { query: { type: "string", required: true, description: "The query." } },
    output: { matches: { type: "string", required: true, description: "Ranked matches." } },
    capabilities: [],
    scopes: { read: ["content/_indexes/**"], write: [] },
    refusals: [],
    steps: [{ id: "load", do: "brain.readIndex" }],
    validators: ["every match resolves to a note path"],
    recovery: { leaves: "nothing", resume: "developer-os brain search" },
    ...overrides,
  };
}

describe("workflowContractSchema", () => {
  it("accepts a minimal well-formed workflow", () => {
    expect(workflowContractSchema.safeParse(contract()).success).toBe(true);
  });

  it("refuses an unknown field rather than ignoring it", () => {
    const result = workflowContractSchema.safeParse(contract({ elevated: true }));
    expect(result.success).toBe(false);
  });

  it("refuses a schemaVersion other than 1, and never coerces it", () => {
    expect(workflowContractSchema.safeParse(contract({ schemaVersion: 2 })).success).toBe(false);
    expect(workflowContractSchema.safeParse(contract({ schemaVersion: "1" })).success).toBe(false);
  });

  it("refuses the scheduled trigger and names DOS-P7", () => {
    /**
     * Spec §15.8. A trigger that validates and never fires is a passing check
     * about a false property, which is the shape this repository has shipped
     * twice. DOS-P7 adds the value in the change that makes launchd fire it.
     */
    const result = workflowContractSchema.safeParse(contract({ triggers: ["scheduled"] }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("DOS-P7");
  });

  it("treats a prototype member as an unknown trigger, not as a retired one", () => {
    /**
     * `RETIRED_TRIGGERS[value]` on a plain object literal is not a lookup — it
     * inherits. `toString` resolved to a `Function`, which is not `undefined`,
     * so the retired branch fired and put a **function** where a message
     * belongs; `screenControlCharacters` then threw `value.replace is not a
     * function` and the whole validation aborted. Four characters in a file
     * crashed the validator. Found by the review of this task.
     */
    for (const hostile of ["toString", "constructor", "valueOf", "__proto__", "hasOwnProperty"]) {
      const result = workflowContractSchema.safeParse(contract({ triggers: [hostile] }));
      expect(result.success, hostile).toBe(false);
      for (const issue of result.error?.issues ?? []) {
        expect(typeof issue.message, hostile).toBe("string");
      }
      expect(JSON.stringify(result.error?.issues), hostile).toContain("unknown trigger");
    }
  });

  it("accepts the three v1 triggers", () => {
    for (const trigger of ["manual", "session_start", "session_end"]) {
      expect(workflowContractSchema.safeParse(contract({ triggers: [trigger] })).success).toBe(true);
    }
  });

  it("requires id to match the slug pattern", () => {
    for (const id of ["Brain-Search", "1brain", "brain_search", ""]) {
      expect(workflowContractSchema.safeParse(contract({ id })).success).toBe(false);
    }
  });

  it("requires version to be a semantic version", () => {
    expect(workflowContractSchema.safeParse(contract({ version: "1.0" })).success).toBe(false);
    expect(workflowContractSchema.safeParse(contract({ version: "1.2.3" })).success).toBe(true);
  });

  it("refuses a step that has both do and prose, and one that has neither", () => {
    expect(
      workflowContractSchema.safeParse(
        contract({ steps: [{ id: "x", do: "brain.readIndex", prose: "text" }] }),
      ).success,
    ).toBe(false);
    expect(
      workflowContractSchema.safeParse(contract({ steps: [{ id: "x" }] })).success,
    ).toBe(false);
  });

  it("refuses two steps sharing an id, because an overlay keys on it", () => {
    expect(
      workflowContractSchema.safeParse(
        contract({
          steps: [
            { id: "same", do: "brain.readIndex" },
            { id: "same", prose: "text" },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("pins where the duplicate-id check does and does not report", () => {
    /**
     * `docs/architecture/workflow-schema.md` §8.2 documents this boundary as a
     * known exception to "every finding, not the first", and nothing pinned it
     * — a residual asserted rather than tested is the shape this repository
     * distrusts. zod runs a root refinement when a child fails a *check* and
     * skips it when a child fails a *type or shape* parse, so the rule is
     * reported alongside a bad trigger and silent alongside a wrong
     * `schemaVersion`. It never fails open: the workflow is refused either way.
     */
    const duplicates = [
      { id: "same", do: "brain.readIndex" },
      { id: "same", prose: "text" },
    ];
    const reports = (overrides: Record<string, unknown>): boolean => {
      const result = workflowContractSchema.safeParse(
        contract({ steps: duplicates, ...overrides }),
      );
      expect(result.success).toBe(false);
      return JSON.stringify(result.error?.issues).includes("duplicate step id");
    };

    expect(reports({}), "duplicates alone").toBe(true);
    expect(reports({ triggers: ["nope"] }), "beside a failed check").toBe(true);
    expect(reports({ schemaVersion: 2 }), "beside a type failure").toBe(false);
    expect(reports({ elevated: true }), "beside an unknown key").toBe(false);
  });

  it("refuses a refusal whose exit code is not a CliExitCode", () => {
    expect(
      workflowContractSchema.safeParse(
        contract({
          refusals: [{ when: "capability-missing", exit: 99, message: "no" }],
        }),
      ).success,
    ).toBe(false);
  });

  it("refuses an unknown refusal condition", () => {
    expect(
      workflowContractSchema.safeParse(
        contract({ refusals: [{ when: "vibes-off", exit: 4, message: "no" }] }),
      ).success,
    ).toBe(false);
  });

  it("refuses exit 0, because a refusal that exits 0 reports failure as success", () => {
    /**
     * `packages/core` already draws this line: `FailureExitCode` excludes
     * `success`, and `failure()` accepts only that. A contract validated with
     * `exit: 0` could not be handed to core's own failure constructor.
     */
    expect(
      workflowContractSchema.safeParse(
        contract({ refusals: [{ when: "vault-missing", exit: 0, message: "no" }] }),
      ).success,
    ).toBe(false);
  });

  it("refuses an empty do and an empty prose", () => {
    for (const step of [{ id: "x", do: "" }, { id: "x", prose: "" }]) {
      expect(
        workflowContractSchema.safeParse(contract({ steps: [step] })).success,
        JSON.stringify(step),
      ).toBe(false);
    }
  });

  it("refuses a version with a leading zero, which is not a semantic version", () => {
    /**
     * `01.2.3` is not semver, and the first regex accepted it because nothing
     * probed anything but `1.0` and `1.2.3`. Pre-release and build metadata stay
     * unsupported on purpose — a shipped workflow version is a release — and
     * that narrowing is stated here rather than left to be discovered.
     */
    for (const version of ["01.2.3", "1.02.3", "1.2.3-rc.1", "1.2.3+build", "v1.2.3"]) {
      expect(
        workflowContractSchema.safeParse(contract({ version })).success,
        version,
      ).toBe(false);
    }
    expect(workflowContractSchema.safeParse(contract({ version: "0.1.0" })).success).toBe(true);
    expect(workflowContractSchema.safeParse(contract({ version: "10.20.30" })).success).toBe(true);
  });

  it("gives the parsed contract the closed types the spec calls closed", () => {
    /**
     * A type-level assertion with a runtime tail. `triggerSchema` was
     * `z.string().superRefine(...)`, so `WorkflowContractV1["triggers"]` inferred
     * as `string[]` and the exported `WorkflowTrigger` was never the type of the
     * field it describes — a renderer got no exhaustiveness checking over a set
     * the spec calls closed. The same widening hit `exit`, which inferred as
     * `number` and so could not be passed to core's `failure()`.
     *
     * **The two annotations below are the assertion**, not the two `expect`
     * calls. Dropping `.pipe(z.enum(...))` leaves every runtime assertion here
     * green; only `tsc` catches it, and `npm run check` runs `tsc -b` before
     * `vitest`. Someone "simplifying" this test by deleting the type annotations
     * would silently remove the only thing it guards.
     */
    const parsed = workflowContractSchema.parse(
      contract({ refusals: [{ when: "vault-missing", exit: 6, message: "gone" }] }),
    );
    const trigger: WorkflowTrigger | undefined = parsed.triggers[0];
    const exit: ExitCode | undefined = parsed.refusals[0]?.exit;
    expect(trigger).toBe("manual");
    expect(exit).toBe(EXIT_CODES.recoveryRequired);
  });
});
