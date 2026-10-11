import { assertUsablePreamble, renderSkillFile } from "@developer-os/workflow-schema";
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
 * Claude's skill file is `renderSkillFile` in the compiler — frontmatter, body
 * and path — because none of it is vendor behaviour: it comes from one contract
 * and must render byte-identically for every vendor. Claude architecture former
 * §7.1's concatenation decision, and the screening rules that go with it, live there.
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

  render(
    contract: WorkflowContractV1,
    overlay: WorkflowOverlayV1 | null,
  ): readonly RenderedArtifact[] {
    return [renderSkillFile(contract, overlay, { shared: this.#shared })];
  }
}
