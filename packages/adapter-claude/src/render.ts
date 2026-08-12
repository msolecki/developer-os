import { screenAndCap } from "@developer-os/security";
import {
  assertRenderableContract,
  assertUsablePreamble,
  renderSkillBody,
  SKILL_FIELD_CAP,
} from "@developer-os/workflow-schema";
import type {
  RenderedArtifact,
  WorkflowContractV1,
  WorkflowOverlayV1,
  WorkflowRenderer,
} from "@developer-os/workflow-schema";

/**
 * Re-exported rather than redeclared. `compose.ts` and this package's public
 * door already name it, and a second copy of the string is how the adapter and
 * the compiler come to disagree about which workflow carries the defence.
 */
export { SHARED_WORKFLOW_ID } from "@developer-os/workflow-schema";

export interface ClaudeRendererDependencies {
  readonly shared: WorkflowContractV1;
}

/**
 * The one field this adapter still screens for itself, bounded by the
 * compiler's cap rather than by a private constant — `description` reaches
 * Claude's frontmatter and Codex's, and the two trees must truncate a long one
 * at the same place.
 *
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
  return JSON.stringify(screenAndCap(value, SKILL_FIELD_CAP));
}

/**
 * Claude's half of a skill: two frontmatter fields and one artifact path.
 *
 * The body — the source marker, the concatenated `shared` preamble, the
 * refusals, steps and recovery — is `renderSkillBody` in the compiler, because
 * none of it is vendor behaviour: it comes from one contract and renders
 * identically for every vendor. Spec §7.1's concatenation decision, and the
 * screening rules that go with it, live there.
 */
export class ClaudeRenderer implements WorkflowRenderer {
  readonly vendor = "claude";
  readonly #shared: WorkflowContractV1;

  /**
   * The shared contract is checked here, not trusted — by the compiler's own
   * check, so no vendor has to remember the two defects it closes: a renderer
   * that keyed "is this shared?" off the rendered contract, and a preamble scan
   * that could pass over an empty set.
   */
  constructor(dependencies: ClaudeRendererDependencies) {
    assertUsablePreamble(dependencies.shared);
    this.#shared = dependencies.shared;
  }

  /**
   * The frontmatter is built from the contract **before** the overlay and the
   * body from the contract after it, which is safe by construction rather than
   * by luck: `workflowOverlaySchema` is `.strict()` with exactly `extends`,
   * `steps`, `lifecycle` and `notes`, and a `steps` value is `{ prose }` alone,
   * so an overlay cannot reach `id`, `version` or `description` — the only
   * fields read here. That schema gaining a field is what would invalidate it.
   */
  render(
    contract: WorkflowContractV1,
    overlay: WorkflowOverlayV1 | null,
  ): readonly RenderedArtifact[] {
    // `id` reaches the artifact path this method builds, so it is refused here
    // as well as inside the body, local to the value each protects.
    assertRenderableContract(contract);
    const lines: string[] = [
      "---",
      `name: ${yamlScalar(`developer-os-${contract.id}`)}`,
      `description: ${yamlScalar(contract.description)}`,
      "---",
      "",
      ...renderSkillBody(contract, overlay, { shared: this.#shared }),
    ];

    return [
      {
        path: `skills/developer-os-${contract.id}/SKILL.md`,
        contents: `${lines.join("\n")}\n`,
      },
    ];
  }
}
