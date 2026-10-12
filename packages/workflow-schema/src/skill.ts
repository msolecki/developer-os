import {
  boundedProse,
  fenced,
  screenAndCap,
  screenControlCharacters,
  screenParagraphs,
} from "@developer-os/security";

import type { WorkflowContractV1 } from "./contract.js";
import { sourceMarker } from "./drift.js";
import type { RenderedArtifact } from "./drift.js";
import { lookupVerb } from "./vocabulary.js";

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
 * The render seam for the vendor-neutral body.
 *
 * `workflow-schema.md` §8.7, amended 2026-08-12: this package used to screen
 * only findings, on the theory that a contract field is payload a renderer
 * emits rather than a message this package prints. That theory covered only
 * findings because this package rendered nothing else. Now that
 * `renderSkillBody` renders the body, this function *is* the screen for it —
 * `id`, `refusals[].message`, `steps[].prose` (via `boundedProse`, below),
 * `recovery.resume`, input names and descriptions, scope globs and `validators`
 * (via `boundedProse`) all pass through it before they reach an artifact.
 * `description` is the one field that never does: it does not appear in the
 * body at all, only in each vendor's frontmatter, so each adapter still
 * screens its own copy — bounded by `SKILL_FIELD_CAP`, exported from this
 * file, so two vendor trees truncate a long one at the same place.
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
 * Claude architecture former §10 and Codex architecture former §9 make each plugin directory the
 * only product-owned path its adapter writes; an `id`
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
 * Claude architecture former §7.1 and Codex architecture former §6.1. `shared` carries the entire
 * prompt-injection defence, and
 * `WorkflowContractV1` has no composition field, so nothing in
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

 */
export function renderSkillBody(
  rendered: WorkflowContractV1,
  options: SkillBodyOptions,
): readonly string[] {
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
    lines.push(...preamble(options.shared, rendered), "");
  }

  lines.push(`# ${screen(rendered.id)}`, "");
  lines.push(...renderRefusals(rendered), "");
  lines.push(...renderInputs(rendered));
  lines.push(...renderScopes(rendered), "");
  lines.push(...renderSteps(rendered), "");
  lines.push(...renderChecks(rendered));
  lines.push(...renderRecovery(rendered));

  return lines;
}

/**
 * A YAML plain scalar built from author text is a corruption waiting to happen.
 * `description: capture: a learning` is a nested mapping and fails the whole
 * frontmatter block, so the skill silently does not load;
 * `description: {allowed-tools: [Bash]}` parses as a **map**, letting an author
 * choose the parsed type of a frontmatter field; `description: # nothing`
 * parses as null. Verified against `yaml@2.8.1`. `JSON.stringify` produces a
 * valid YAML double-quoted scalar, which is why it is the fix rather than
 * hand-rolled quoting. Found by fresh-context review, 2026-08-11.
 */
function yamlScalar(value: string): string {
  return JSON.stringify(screenAndCap(value, SKILL_FIELD_CAP));
}

/** The whole `SKILL.md`, identical for every vendor: frontmatter, body and path. */
export function renderSkillFile(
  contract: WorkflowContractV1,
  options: SkillBodyOptions,
): RenderedArtifact {
  // `id` reaches the artifact path built here, so it is refused before it is used.
  assertRenderableContract(contract);
  const lines: string[] = [
    "---",
    `name: ${yamlScalar(`developer-os-${contract.id}`)}`,
    `description: ${yamlScalar(contract.description)}`,
    "---",
    "",
    ...renderSkillBody(contract, options),
  ];
  return { path: `skills/developer-os-${contract.id}/SKILL.md`, contents: `${lines.join("\n")}\n` };
}

function preamble(
  shared: WorkflowContractV1,
  rendered: WorkflowContractV1,
): readonly string[] {
  // No note saying where this came from: the body is model-visible, and a
  // rendering note there is noise the agent has to read past (NEW-66).
  return [
    "## Always",
    "",
    ...preambleBody(shared, new Set(rendered.refusals.map((refusal) => refusal.when))),
  ];
}

/**
 * The preamble's actual content, separated from its heading so
 * `assertUsablePreamble` can require it to be non-empty. A heading is not a
 * defence.
 */
function preambleBody(
  shared: WorkflowContractV1,
  redeclared: ReadonlySet<string>,
): readonly string[] {
  // A refusal the workflow declares itself renders once, in its own words:
  // two `vault-missing` lines with different messages leave the agent to
  // reconcile them.
  const inherited = {
    ...shared,
    refusals: shared.refusals.filter((refusal) => !redeclared.has(refusal.when)),
  };
  return [
    ...renderRefusals(inherited, (message) =>
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

/** Omitted when empty: a heading with nothing under it says nothing (AUD-021). */
function renderInputs(contract: WorkflowContractV1): readonly string[] {
  const entries = Object.entries(contract.inputs);
  if (entries.length === 0) return [];
  return [
    "## Inputs",
    "",
    ...entries.map(([name, field]) =>
      `- \`${screen(name)}\` (${field.type}, ${field.required ? "required" : "optional"}): ${screen(field.description)}`),
    "",
  ];
}

/**
 * The boundary the preamble tells the agent to stay inside, so it is always rendered (AUD-021).
 * Globs are fenced rather than inlined: they are free strings, and a backtick in one would
 * otherwise end its code span.
 */
function renderScopes(contract: WorkflowContractV1): readonly string[] {
  const list = (label: string, globs: readonly string[]): readonly string[] =>
    globs.length === 0 ? [`${label}: none`] : [`${label}:`, "", ...fenced(globs.map(screen).join("\n"), "text")];
  return ["## Scopes", "", ...list("Read", contract.scopes.read), "", ...list("Write", contract.scopes.write)];
}

function renderChecks(contract: WorkflowContractV1): readonly string[] {
  if (contract.validators.length === 0) return [];
  return [
    "## Checks",
    "",
    ...contract.validators.flatMap((validator) => bullet(boundedProse(validator, SKILL_FIELD_CAP).split("\n\n"))),
    "",
  ];
}

const SHARED_COMMAND_NOTE = "Runs inside the command above; do not run it again.";

const INPUT_PLACEHOLDER_NOTE =
  "A value written `$input.<name>` stands for the workflow input `<name>`: replace it with what the user supplied for that input.";

/**
 * A step is prose or a verb, never both and never neither — the contract
 * enforces that, so the `else` branch here is a verb by construction. `with` is
 * rendered as a fenced JSON block rather than interpolated into a sentence,
 * because its values are arbitrary and unvalidated at this layer
 * (`workflow-schema.md` §8.6).
 */
function renderSteps(contract: WorkflowContractV1): readonly string[] {
  const lines: string[] = ["## Steps", ""];
  // AUD-020: three ingest verbs are one `developer-os ingest`; rendering it three times ran it three times.
  let previousCommand: string | null = null;
  for (const step of contract.steps) {
    lines.push(`### ${screen(step.id)}`, "");
    const sharedCommand: string | null = previousCommand;
    previousCommand = null;
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
    /**
     * The command an agent would run for this verb, named right beside the
     * effect it names — the fix for knowledge-pipeline architecture note §1's finding that three shipped
     * skills, in both vendor trees, named commands that do not exist because
     * nothing in the pipeline mapped a verb to an invocation. `lookupVerb`
     * returns `undefined` for a verb outside the vocabulary and `null` for
     * one of the four the vocabulary itself declares commandless
     * (`agent.prompt`, `cli.run`, `brain.readIndex`, `brain.readNote`); both
     * cases render nothing rather than a line with nothing in it. Fenced as
     * `text`, never `bash` — the same rule `renderRecovery` applies to
     * `recovery.resume`, for the same reason: nothing downstream should offer
     * to run it.
     */
    const command = lookupVerb(step.do)?.command;
    if (command != null && step.with === undefined && command === sharedCommand) {
      lines.push(SHARED_COMMAND_NOTE, "");
      previousCommand = command;
      continue;
    }
    if (command != null) {
      lines.push(...fenced(screen(command), "text"), "");
      if (step.with === undefined) previousCommand = command;
    }
    if (step.with !== undefined) {
      const json = JSON.stringify(step.with);
      if (json.includes('"$input.')) {
        lines.push(INPUT_PLACEHOLDER_NOTE, "");
      }
      lines.push(...fenced(screen(json), "json"), "");
    }
  }
  return lines;
}

/**
 * Claude architecture former §7.2 and Codex architecture former §6.2. `recovery.resume` is a
 * command string that **nothing in this
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
