import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { compareScopes, deriveScopes, loadWorkflow } from "@developer-os/workflow-schema";
import type { WorkflowContractV1 } from "@developer-os/workflow-schema";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WORKFLOWS = join(ROOT, "workflows");

const EXPECTED = [
  "brain-search",
  "capture",
  "doctor",
  "ingest",
  "review",
  "shared",
] as const;

async function directories(): Promise<string[]> {
  const entries = await readdir(WORKFLOWS, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function mustLoad(relativePath: string): WorkflowContractV1 {
  const text = readFileSync(join(ROOT, relativePath), "utf8");
  const result = loadWorkflow({ file: relativePath, text });
  if (result.contract === null) {
    throw new Error(
      `${relativePath} did not validate: ${result.findings.map((finding) => finding.message).join("; ")}`,
    );
  }
  return result.contract;
}

/**
 * `readFileSync`, not `await readFile`: the assertions below are synchronous
 * `it` bodies, and `loadWorkflow` takes text rather than a path. Reuses
 * `EXPECTED` above rather than a second id list — two lists in one file that
 * must agree is how they come to disagree.
 */
function canonicalContracts(): readonly WorkflowContractV1[] {
  return EXPECTED.map((id) => mustLoad(`workflows/${id}/workflow.yaml`));
}

describe("canonical workflows", () => {
  it("ships exactly the six named by Workflow architecture former §10", async () => {
    expect(await directories()).toStrictEqual([...EXPECTED]);
  });

  it("validates every one of them with no error finding", async () => {
    const names = await directories();
    /** A sweep over an empty set proves nothing. */
    expect(names.length).toBe(EXPECTED.length);

    for (const name of names) {
      const file = join("workflows", name, "workflow.yaml");
      const text = await readFile(join(WORKFLOWS, name, "workflow.yaml"), "utf8");
      const result = loadWorkflow({ file, text });
      expect(
        result.findings.filter((finding) => finding.severity === "error"),
        `${file} has error findings`,
      ).toStrictEqual([]);
      expect(result.contract?.id, `${file} id must equal its directory`).toBe(name);
    }
  });

  it("keeps every vault write inside capture, review and ingest, and expresses each in verbs only", async () => {
    /**
     * The name says all three. It used to say "review and ingest" while the
     * assertion allowed `capture` as well — the assertion is right, because
     * `content/_raw/quarantine/**` is a vault path and capture is the workflow
     * that writes it, but somebody auditing the gate by its title believed a
     * stronger property was checked than is.
     */
    const names = await directories();
    /** Per scope. A sweep over an empty set proves nothing, and a sibling test asserting the count is not this test's guard. */
    expect(names.length).toBe(EXPECTED.length);

    for (const name of names) {
      const text = await readFile(join(WORKFLOWS, name, "workflow.yaml"), "utf8");
      const result = loadWorkflow({ file: name, text });
      const contract = result.contract;
      expect(contract).not.toBeNull();
      if (contract === null) continue;

      if (contract.scopes.write.length > 0) {
        expect(["review", "ingest", "capture"]).toContain(name);
        expect(
          contract.steps.filter((step) => step.prose !== undefined),
          `${name} writes and must be expressed in effect verbs only`,
        ).toStrictEqual([]);
      }
    }
  });

  it("declares no trigger nothing can fire", () => {
    const contracts = canonicalContracts();
    expect(contracts).toHaveLength(6);
    for (const contract of contracts) {
      expect(contract.triggers, contract.id).not.toContain("session_end");
      expect(contract.triggers, contract.id).not.toContain("session_start");
      expect(contract.triggers.length, contract.id).toBeGreaterThan(0);
    }
  });

  it("declares scopes equal to what its steps derive", () => {
    const contracts = canonicalContracts();
    expect(contracts.length).toBeGreaterThan(0);
    for (const contract of contracts) {
      expect(compareScopes(contract.scopes, deriveScopes(contract)), contract.id).toEqual([]);
    }
  });

  it("declares the edit verb its decision input advertises", () => {
    const review = canonicalContracts().find((c) => c.id === "review");
    expect(review?.steps.map((s) => s.do)).toContain("capture.edit");
  });
});
