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
 * Re-exported rather than redeclared, for the same reason `ClaudeRenderer`
 * re-exports it: a second copy of the string is how this adapter and the
 * compiler come to disagree about which workflow carries the defence.
 */
export { SHARED_WORKFLOW_ID } from "@developer-os/workflow-schema";

export interface CodexRendererDependencies {
  readonly shared: WorkflowContractV1;
}

function yamlScalar(value: string): string {
  return JSON.stringify(screenAndCap(value, SKILL_FIELD_CAP));
}

/**
 * Codex's half of a skill: two frontmatter fields and one artifact path.
 * Everything else — the source marker, the shared preamble, the refusals,
 * steps and recovery — is `renderSkillBody` in the compiler; see
 * `ClaudeRenderer` for the reasoning, which is identical here.
 */
export class CodexRenderer implements WorkflowRenderer {
  readonly vendor = "codex";
  readonly #shared: WorkflowContractV1;

  constructor(dependencies: CodexRendererDependencies) {
    assertUsablePreamble(dependencies.shared);
    this.#shared = dependencies.shared;
  }

  render(
    contract: WorkflowContractV1,
    overlay: WorkflowOverlayV1 | null,
  ): readonly RenderedArtifact[] {
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
