import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  RenderedArtifact,
  WorkflowContractV1,
  WorkflowRenderer,
} from "@developer-os/workflow-schema";
import {
  detectWorkflowDrift,
  loadWorkflow,
  sourceMarker,
} from "@developer-os/workflow-schema";
import { describe, expect, it } from "vitest";

const WORKFLOWS = fileURLToPath(new URL("../../../workflows/", import.meta.url));

/**
 * A stub, because this package ships no renderer by design (spec §14). It is
 * enough to prove the pipeline is deterministic; the byte-identity of real
 * vendor artifacts belongs to DOS-P4 and DOS-P5.
 */
const stub: WorkflowRenderer = {
  vendor: "stub",
  render(contract: WorkflowContractV1): readonly RenderedArtifact[] {
    return [
      {
        path: `rendered/${contract.id}.md`,
        contents: `${sourceMarker(contract, `workflows/${contract.id}/workflow.yaml`)}\n${contract.steps
          .map((step) => step.id)
          .join("\n")}\n`,
      },
    ];
  },
};

/**
 * Returns the directory count beside the contracts, because a loader that
 * silently drops what it cannot parse turns every assertion below into a claim
 * about whatever survived. Five of six workflows could stop parsing and this
 * file would still be green over the sixth — the "gate that can pass by scanning
 * nothing" rule, scaled down to one.
 */
async function loadAll(
  reversed: boolean,
): Promise<{ contracts: WorkflowContractV1[]; expected: number }> {
  const entries = await readdir(WORKFLOWS, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const ordered = reversed ? [...names].reverse() : names;

  const contracts: WorkflowContractV1[] = [];
  for (const name of ordered) {
    const text = await readFile(join(WORKFLOWS, name, "workflow.yaml"), "utf8");
    const result = loadWorkflow({ file: `workflows/${name}/workflow.yaml`, text });
    if (result.contract !== null) contracts.push(result.contract);
  }
  return { contracts, expected: names.length };
}

async function loadAllOrFail(reversed: boolean): Promise<WorkflowContractV1[]> {
  const { contracts, expected } = await loadAll(reversed);
  expect(expected, "no workflow directories were found").toBeGreaterThan(0);
  expect(contracts, "a workflow failed to load and was dropped").toHaveLength(expected);
  return contracts;
}

describe("determinism", () => {
  it("loads the same contracts twice, byte for byte", async () => {
    const first = await loadAllOrFail(false);
    const second = await loadAllOrFail(false);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("renders identically under a reversed directory order", async () => {
    const forward = await loadAllOrFail(false);
    const reversed = await loadAllOrFail(true);

    /**
     * That the reversal happened at all. Without this the test would pass with
     * `.reverse()` deleted, which is what it was doing: the comparison below
     * used to sort by id first, erasing the ordering it set out to vary, so it
     * proved that sorting is idempotent.
     */
    expect(reversed.map((contract) => contract.id)).toStrictEqual(
      [...forward].reverse().map((contract) => contract.id),
    );

    /**
     * Compared **unsorted**, so a canonical ordering has to come from somewhere
     * other than this test. There is no ordering helper in this package today —
     * so what this pins is that each contract renders identically regardless of
     * the order it was read in, and that a renderer must impose its own stable
     * order. That last part is owed by DOS-P4 and DOS-P5 along with the rest of
     * spec §13's byte-identity requirement.
     */
    const renderById = (contracts: WorkflowContractV1[]): Map<string, string> =>
      new Map(
        contracts.flatMap((contract) =>
          stub
            .render(contract, null)
            .map((artifact) => [artifact.path, artifact.contents] as const),
        ),
      );

    const forwardArtifacts = renderById(forward);
    const reversedArtifacts = renderById(reversed);
    expect(forwardArtifacts.size).toBe(forward.length);
    for (const [path, contents] of forwardArtifacts) {
      expect(reversedArtifacts.get(path), path).toBe(contents);
    }
  });

  it("reports no drift when the rendered artifacts are what is on disk", async () => {
    const contracts = await loadAllOrFail(false);
    const rendered = contracts.flatMap((contract) => stub.render(contract, null));
    expect(rendered.length).toBe(contracts.length);
    const onDisk = new Map(rendered.map((artifact) => [artifact.path, artifact.contents]));
    expect(detectWorkflowDrift(rendered, onDisk)).toStrictEqual([]);
  });

  it("reports drift when a single byte of one artifact changes", async () => {
    /**
     * The three assertions above all describe agreement, and a drift check that
     * never reports anything satisfies every one of them. This is the half that
     * fails when the detector stops working.
     */
    const contracts = await loadAllOrFail(false);
    const rendered = contracts.flatMap((contract) => stub.render(contract, null));
    const [first] = rendered;
    expect(first).toBeDefined();
    if (first === undefined) return;

    const onDisk = new Map(rendered.map((artifact) => [artifact.path, artifact.contents]));
    onDisk.set(first.path, first.contents.replace("Generated", "Generatee"));

    const findings = detectWorkflowDrift(rendered, onDisk);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe(first.path);
    expect(findings[0]?.line).toBe(1);
  });
});
