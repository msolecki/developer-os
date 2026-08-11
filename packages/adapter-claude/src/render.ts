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
 * A YAML plain scalar built from author text is a corruption waiting to happen.
 * `description: capture: a learning` is a nested mapping and fails the whole
 * frontmatter block, so the skill silently does not load;
 * `description: {allowed-tools: [Bash]}` parses as a **map**, letting an author
 * choose the parsed type of a frontmatter field; `description: # nothing`
 * parses as null. Verified against `yaml@2.8.1`, the version this repository
 * already depends on.
 *
 * `JSON.stringify` produces a valid YAML double-quoted scalar, which is why it
 * is the fix rather than hand-rolled quoting. Found by fresh-context review,
 * 2026-08-11.
 */
function yamlScalar(value: string): string {
  return JSON.stringify(screen(value));
}

/** The compiler's own slug rule. */
const SLUG = /^[a-z][a-z0-9-]*$/u;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

/**
 * `id` reaches the artifact **path** and `version` reaches the source marker,
 * and this class accepts anything typed as `WorkflowContractV1` — a value that
 * came from `validateWorkflow` today and could come from code tomorrow. Spec
 * §10 says the plugin directory is the only path this adapter writes; an `id`
 * of `../../evil` would break that, and the render seam is where the rule "the
 * first surface owns screening it" applies.
 */
function assertRenderable(contract: WorkflowContractV1): void {
  if (!SLUG.test(contract.id)) {
    throw new Error(
      `workflow id is not a slug and reaches an artifact path: ${JSON.stringify(screen(contract.id))}`,
    );
  }
  if (!SEMVER.test(contract.version)) {
    throw new Error(
      `workflow version is not MAJOR.MINOR.PATCH: ${JSON.stringify(screen(contract.version))}`,
    );
  }
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

  /**
   * The shared contract is checked here, not trusted.
   *
   * `render` used to key "is this shared?" off the *rendered* contract's id
   * rather than off this dependency, so handing in any contract as `shared`
   * silently prepended its refusals to all six artifacts as though they were
   * the prompt-injection defence. And `#preamble` was a scan that could pass
   * over an empty set — a `shared` with no refusals and no prose emitted a
   * heading with nothing under it, shipping six artifacts with no defence and
   * no error. Both found by fresh-context review, 2026-08-11.
   */
  constructor(dependencies: ClaudeRendererDependencies) {
    if (dependencies.shared.id !== SHARED_WORKFLOW_ID) {
      throw new Error(
        `the shared dependency must be the \`${SHARED_WORKFLOW_ID}\` workflow, not \`${screen(dependencies.shared.id)}\``,
      );
    }
    assertRenderable(dependencies.shared);
    this.#shared = dependencies.shared;
    if (preambleBody(dependencies.shared).length === 0) {
      throw new Error(
        "the shared workflow renders an empty preamble; it carries the prompt-injection defence and every other artifact depends on it being non-empty",
      );
    }
  }

  render(
    contract: WorkflowContractV1,
    overlay: WorkflowOverlayV1 | null,
  ): readonly RenderedArtifact[] {
    void overlay;
    assertRenderable(contract);
    const lines: string[] = [
      "---",
      `name: ${yamlScalar(`developer-os-${contract.id}`)}`,
      `description: ${yamlScalar(contract.description)}`,
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
    return [
      `<!-- preamble from ${SHARED_WORKFLOW_ID}; concatenated, not referenced -->`,
      "",
      "## Always",
      "",
      ...preambleBody(this.#shared),
    ];
  }
}

/**
 * The preamble's actual content, separated from its heading so the constructor
 * can require it to be non-empty. A heading is not a defence.
 */
function preambleBody(shared: WorkflowContractV1): readonly string[] {
  return [
    ...renderRefusals(shared),
    ...shared.steps.flatMap((step) =>
      step.prose === undefined ? [] : [`- ${screen(step.prose)}`],
    ),
  ];
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
    // The contract makes a step `do` XOR `prose`. If neither is present the
    // value did not come from `validateWorkflow`, and rendering an empty
    // `Effect: ``` would hide that in the artifact rather than report it.
    if (step.do === undefined) {
      throw new Error(
        `step \`${screen(step.id)}\` carries neither an effect nor prose`,
      );
    }
    lines.push(`Effect: \`${screen(step.do)}\``, "");
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
