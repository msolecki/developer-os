import {
  boundedProse,
  fenced,
  screenAndCap,
  screenControlCharacters,
  screenParagraphs,
} from "@developer-os/security";

import type { WorkflowContractV1 } from "./contract.js";
import { sourceMarker } from "./drift.js";
import { applyOverlay } from "./overlay.js";
import type { WorkflowOverlayV1 } from "./overlay.js";

export const SHARED_WORKFLOW_ID = "shared";

/**
 * Generous, and still a bound. `workflow-schema.md` §8.3 records that an
 * unbounded interpolation is how a hostile field reaches a terminal; the
 * compiler caps its own findings at 64 graphemes, but these are the payload a
 * renderer emits rather than a message it prints, so the bound is larger and
 * still finite.
 *
 * Exported, because the one field an adapter still screens for itself — the
 * `description` in its own frontmatter — must truncate at the same place in
 * every vendor tree. Two adapters inventing their own cap is two trees that
 * differ on a long description and no test that compares them.
 */
export const SKILL_FIELD_CAP = 4096;

export interface SkillBodyOptions {
  /** The `shared` contract, whose refusals and prose become the preamble. */
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
  return screenAndCap(value, SKILL_FIELD_CAP);
}

/**
 * Preamble prose: screened, never capped, and refused when it would have been.
 *
 * `screenAndCap` truncates at the bound and appends an ellipsis with no error,
 * which is acceptable for payload a reader can go and look up and unacceptable
 * for the text that *is* the prompt-injection defence. Capping is not what makes
 * the preamble safe; screening is. The bound is checked on the joined block for
 * the reason above.
 */
function refusingParagraphs(value: string, field: string): readonly string[] {
  const paragraphs = screenParagraphs(value);
  if (paragraphs.join("\n\n").length > SKILL_FIELD_CAP) {
    throw new Error(
      `one of the shared workflow's ${field} values is longer than ${String(SKILL_FIELD_CAP)} characters once screened; the preamble carries the prompt-injection defence and is refused rather than truncated. The bound is per value, not over the whole preamble`,
    );
  }
  return paragraphs;
}

function screenOrRefuse(value: string, field: string): string {
  const screened = screenControlCharacters(value);
  if (screened.length > SKILL_FIELD_CAP) {
    throw new Error(
      `one of the shared workflow's ${field} values is longer than ${String(SKILL_FIELD_CAP)} characters once screened; the preamble carries the prompt-injection defence and is refused rather than truncated. The bound is per value, not over the whole preamble`,
    );
  }
  return screened;
}

/** The compiler's own slug rule. */
const SLUG = /^[a-z][a-z0-9-]*$/u;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

/**
 * `id` reaches the artifact **path** and `version` reaches the source marker,
 * and every renderer accepts anything typed as `WorkflowContractV1` — a value
 * that came from `validateWorkflow` today and could come from code tomorrow.
 * Spec §10 says the plugin directory is the only path an adapter writes; an `id`
 * of `../../evil` would break that, and the render seam is where the rule "the
 * first surface owns screening it" applies.
 *
 * Exported, because an adapter builds its artifact path from the same `id` and
 * must be able to refuse it before it does.
 */
export function assertRenderableContract(contract: WorkflowContractV1): void {
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
 * The `shared` contract is checked, not trusted.
 *
 * A renderer used to key "is this shared?" off the *rendered* contract's id
 * rather than off its dependency, so handing in any contract as `shared`
 * silently prepended its refusals to all six artifacts as though they were the
 * prompt-injection defence. And the preamble was a scan that could pass over an
 * empty set — a `shared` with no refusals and no prose emitted a heading with
 * nothing under it, shipping six artifacts with no defence and no error. Both
 * found by fresh-context review, 2026-08-11.
 *
 * Every adapter calls this in its constructor, so the check does not depend on
 * each vendor remembering it.
 */
export function assertUsablePreamble(shared: WorkflowContractV1): void {
  if (shared.id !== SHARED_WORKFLOW_ID) {
    throw new Error(
      `the shared dependency must be the \`${SHARED_WORKFLOW_ID}\` workflow, not \`${screen(shared.id)}\``,
    );
  }
  assertRenderableContract(shared);
  /**
   * Per scope, not in total. A combined check passed on the refusals alone, so
   * a `shared` whose prose screened to nothing — whitespace, or a single format
   * character — shipped six artifacts carrying refusals and no defence, with no
   * error. Second review, same day, same class of defect as the empty-preamble
   * check it strengthens.
   */
  if (preambleProse(shared).length === 0) {
    throw new Error(
      "the shared workflow's preamble prose is empty; it carries the prompt-injection defence and every other artifact depends on it being non-empty",
    );
  }
}

/**
 * The vendor-neutral half of a skill: everything below the frontmatter.
 *
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
 *
 * It lives here rather than in an adapter because none of it is vendor
 * behaviour: it comes from one contract and renders identically for every
 * vendor. What stays with each adapter is its frontmatter fields, its artifact
 * path and its plugin manifest.
 *
 * The overlay is **applied**, not discarded. It used to be `void overlay`, so a
 * caller who passed one lost it silently and no test failed — while spec §7 says
 * the input is a contract plus its optional vendor overlay. `applyOverlay` is
 * the compiler's own merge and the only thing that knows an overlay is
 * presentation-only; re-implementing the rule here is how the two come to
 * disagree. A refused overlay throws, because rendering the base contract
 * instead would silently produce an artifact the caller did not ask for.
 *
 * `OverlayOutcome.lifecycle` is deliberately unused: DOS-P4 emits no hook
 * artifact at all (spec §6, amended 2026-08-11), so there is nothing for a
 * lifecycle binding to bind to. Owner of the restoration: DOS-P6.
 */
export function renderSkillBody(
  contract: WorkflowContractV1,
  overlay: WorkflowOverlayV1 | null,
  options: SkillBodyOptions,
): readonly string[] {
  assertRenderableContract(contract);
  const rendered = applied(contract, overlay);
  // Again, on the object the marker is actually built from. `applyOverlay`
  // cannot move `id` or `version` today; the assertion is local to the value
  // it protects rather than to the one that preceded it.
  assertRenderableContract(rendered);

  /**
   * Derived here, never handed in. A caller-supplied marker would let two
   * vendor trees carry different ones for the same workflow, and neither
   * adapter's drift gate can see the other's input.
   */
  const lines: string[] = [
    `<!-- ${sourceMarker(rendered, `workflows/${rendered.id}/workflow.yaml`)} -->`,
    "",
  ];

  if (rendered.id !== SHARED_WORKFLOW_ID) {
    lines.push(...preamble(options.shared), "");
  }

  lines.push(`# ${screen(rendered.id)}`, "");
  lines.push(...renderRefusals(rendered), "");
  lines.push(...renderSteps(rendered), "");
  lines.push(...renderRecovery(rendered));

  return lines;
}

function applied(
  contract: WorkflowContractV1,
  overlay: WorkflowOverlayV1 | null,
): WorkflowContractV1 {
  if (overlay === null) return contract;
  /**
   * An overlay on `shared` is refused rather than applied. The preamble has
   * one reviewable home and is concatenated into five other artifacts from
   * the injected dependency, which no overlay reaches — so an overlaid
   * `shared` skill would state one defence while the five copies stated
   * another. Second review, 2026-08-11.
   */
  if (contract.id === SHARED_WORKFLOW_ID) {
    throw new Error(
      "the overlay was refused: the shared workflow carries the prompt-injection defence concatenated into every other artifact, and an overlay would make the copies disagree",
    );
  }
  const outcome = applyOverlay(contract, overlay);
  if (!outcome.ok) {
    // Screened: `applyOverlay` screens a step id but leaves `extends`
    // unscreened, because its schema constrains it — and this seam is typed
    // rather than parsed, so nothing here has run that schema.
    throw new Error(`the overlay was refused: ${screen(outcome.reason)}`);
  }
  return outcome.contract;
}

function preamble(shared: WorkflowContractV1): readonly string[] {
  return [
    `<!-- preamble from ${SHARED_WORKFLOW_ID}; concatenated, not referenced -->`,
    "",
    "## Always",
    "",
    ...preambleBody(shared),
  ];
}

/**
 * The preamble's actual content, separated from its heading so
 * `assertUsablePreamble` can require it to be non-empty. A heading is not a
 * defence.
 */
function preambleBody(shared: WorkflowContractV1): readonly string[] {
  return [
    ...renderRefusals(shared, (message) =>
      screenOrRefuse(message, "refusal message"),
    ),
    ...preambleProse(shared),
  ];
}

/** The prose half alone, so the check above can require *this* scope non-empty. */
function preambleProse(shared: WorkflowContractV1): readonly string[] {
  return shared.steps.flatMap((step) =>
    step.prose === undefined
      ? []
      : bullet(refusingParagraphs(step.prose, "preamble prose")),
  );
}

/**
 * A bullet whose continuation paragraphs are indented by two spaces, which is
 * what keeps them inside the list item instead of ending it. One paragraph
 * renders exactly as the single-line bullet always did.
 */
function bullet(paragraphs: readonly string[]): readonly string[] {
  const [first, ...rest] = paragraphs;
  if (first === undefined) return [];
  return [`- ${first}`, ...rest.flatMap((paragraph) => ["", `  ${paragraph}`])];
}

function renderRefusals(
  contract: WorkflowContractV1,
  screener: (value: string) => string = screen,
): readonly string[] {
  return contract.refusals.map(
    (refusal) =>
      `- **Refuse** (${screen(refusal.when)}, exit ${String(refusal.exit)}): ${screener(refusal.message)}`,
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
      const block = boundedProse(step.prose, SKILL_FIELD_CAP);
      // Prose that screens to nothing is a heading with no body — a step that
      // says nothing, reported rather than rendered blank.
      if (block.length === 0) {
        throw new Error(
          `step \`${screen(step.id)}\` carries prose that renders to nothing`,
        );
      }
      lines.push(block, "");
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
      lines.push(...fenced(screen(JSON.stringify(step.with)), "json"), "");
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
    // `leaves` is a line, and a line beginning with a fence run opens a code
    // block that swallows the warning below it. `fenced` protects the payload
    // positions; `boundedProse` protects this one. Second review, 2026-08-11.
    boundedProse(contract.recovery.leaves, SKILL_FIELD_CAP),
    "",
    "Do not run this automatically. It is text for a person to read:",
    "",
    ...fenced(screen(contract.recovery.resume), "text"),
  ];
}
