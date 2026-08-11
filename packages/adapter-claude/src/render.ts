import { screenAndCap } from "@developer-os/security";
import { sourceMarker } from "@developer-os/workflow-schema";
import type {
  RenderedArtifact,
  WorkflowContractV1,
  WorkflowOverlayV1,
  WorkflowRenderer,
} from "@developer-os/workflow-schema";

export const SHARED_WORKFLOW_ID = "shared";

/**
 * Generous, and still a bound. `workflow-schema.md` §8.3 records that an
 * unbounded interpolation is how a hostile field reaches a terminal; the
 * compiler caps its own findings at 64 graphemes, but these are the payload a
 * renderer emits rather than a message it prints, so the bound is larger and
 * still finite.
 */
const FIELD_CAP = 4096;

export interface ClaudeRendererDependencies {
  readonly shared: WorkflowContractV1;
}

/**
 * The render seam.
 *
 * `workflow-schema.md` §8.7: the compiler screens findings and deliberately
 * does **not** screen contract fields, because those are the payload a renderer
 * emits. The first surface to display one owns screening it, and this is that
 * surface.
 */
function screen(value: string): string {
  return screenAndCap(value, FIELD_CAP);
}

/**
 * Spec §7.1. `shared` carries the entire prompt-injection defence, and
 * `WorkflowContractV1` has no composition field — `WorkflowOverlayV1.extends`
 * pins an overlay to its base, which is a different relation — so nothing in
 * the contract delivers that preamble to the other five workflows. The
 * renderer does.
 *
 * Concatenated rather than referenced from one shared guidance artifact. The
 * defence is then physically present in every file that needs it, so no load
 * order, surface availability or user setting can remove it. The cost, accepted
 * by the founder on 2026-08-11, is that it appears five times in the output.
 */
export class ClaudeRenderer implements WorkflowRenderer {
  readonly vendor = "claude";
  readonly #shared: WorkflowContractV1;

  constructor(dependencies: ClaudeRendererDependencies) {
    this.#shared = dependencies.shared;
  }

  render(
    contract: WorkflowContractV1,
    overlay: WorkflowOverlayV1 | null,
  ): readonly RenderedArtifact[] {
    void overlay;
    const lines: string[] = [
      "---",
      `name: developer-os-${screen(contract.id)}`,
      `description: ${screen(contract.description)}`,
      "---",
      "",
      `<!-- ${sourceMarker(contract, `workflows/${contract.id}/workflow.yaml`)} -->`,
      "",
    ];

    if (contract.id !== SHARED_WORKFLOW_ID) {
      lines.push(...this.#preamble(), "");
    }

    lines.push(`# ${screen(contract.id)}`, "");
    lines.push(...renderRefusals(contract), "");
    lines.push(...renderSteps(contract), "");
    lines.push(...renderRecovery(contract));

    return [
      {
        path: `skills/developer-os-${contract.id}/SKILL.md`,
        contents: `${lines.join("\n")}\n`,
      },
    ];
  }

  #preamble(): readonly string[] {
    const shared = this.#shared;
    return [
      `<!-- preamble from ${SHARED_WORKFLOW_ID}; concatenated, not referenced -->`,
      "",
      "## Always",
      "",
      ...renderRefusals(shared),
      ...shared.steps.flatMap((step) =>
        step.prose === undefined ? [] : [`- ${screen(step.prose)}`],
      ),
    ];
  }
}

function renderRefusals(contract: WorkflowContractV1): readonly string[] {
  return contract.refusals.map(
    (refusal) =>
      `- **Refuse** (${screen(refusal.when)}, exit ${String(refusal.exit)}): ${screen(refusal.message)}`,
  );
}

/**
 * A step is prose or a verb, never both and never neither — the contract
 * enforces that, so the `else` branch here is a verb by construction. `with` is
 * rendered as a fenced JSON block rather than interpolated into a sentence,
 * because its values are arbitrary and unvalidated at this layer
 * (`workflow-schema.md` §8.6).
 */
function renderSteps(contract: WorkflowContractV1): readonly string[] {
  const lines: string[] = ["## Steps", ""];
  for (const step of contract.steps) {
    lines.push(`### ${screen(step.id)}`, "");
    if (step.prose !== undefined) {
      lines.push(screen(step.prose), "");
      continue;
    }
    lines.push(`Effect: \`${screen(step.do ?? "")}\``, "");
    if (step.with !== undefined) {
      lines.push("```json", screen(JSON.stringify(step.with)), "```", "");
    }
  }
  return lines;
}

/**
 * Spec §7.2. `recovery.resume` is a command string that **nothing in this
 * product executes**, and `workflow-schema.md` §6 hands the adapters the rule
 * that whichever surface first displays it must treat it as data. It is fenced
 * as `text` rather than `bash` so no renderer downstream offers to run it, and
 * it is never emitted into `hooks.json` or any command position.
 */
function renderRecovery(contract: WorkflowContractV1): readonly string[] {
  return [
    "## Recovery",
    "",
    screen(contract.recovery.leaves),
    "",
    "Do not run this automatically. It is text for a person to read:",
    "",
    "```text",
    screen(contract.recovery.resume),
    "```",
  ];
}
