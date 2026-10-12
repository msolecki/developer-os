import { assertUsablePreamble, renderSkillFile } from "@developer-os/workflow-schema";
import type {
  RenderedArtifact,
  WorkflowContractV1,
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

/**
 * Codex's skill file is `renderSkillFile` in the compiler — frontmatter, body
 * and path; see `ClaudeRenderer` for the reasoning, which is identical here.
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
  ): readonly RenderedArtifact[] {
    return [renderSkillFile(contract, { shared: this.#shared })];
  }
}
