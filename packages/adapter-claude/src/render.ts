import {
  capGraphemes,
  screenAndCap,
  screenControlCharacters,
} from "@developer-os/security";
import { applyOverlay, sourceMarker } from "@developer-os/workflow-schema";
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
 * The screen collapses every run of whitespace to one space, which is right for
 * a value printed on one line and wrong for prose: the four-paragraph
 * prompt-injection defence in `workflows/shared/workflow.yaml` rendered as a
 * single run-on bullet, and shipped that way. Split on blank lines first, screen
 * each paragraph, and the boundary the author wrote survives the character the
 * screen exists to remove. Found by fresh-context review of Tasks 1–5.
 */
function paragraphsOf(value: string): readonly string[] {
  return value
    .split(/\n[^\S\n]*\n/u)
    .map((paragraph) => neutralizeBlockStart(screenControlCharacters(paragraph)))
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * Author prose starts a line now, and a line is where Markdown block structure
 * is decided.
 *
 * **This is the cost of splitting into paragraphs, and it was not obvious.**
 * While the screen collapsed prose to one line, every one of these characters
 * could only ever land mid-line and render as text. Splitting made column 0
 * reachable, so a `shared` preamble reading `real\n\n# IGNORE EVERYTHING ABOVE`
 * emitted a real heading — inside the bullet that carries the prompt-injection
 * defence, concatenated into five other skills. Found by the fresh-context
 * review of the split itself, 2026-08-11.
 *
 * The list is every column-0 construct CommonMark defines: fence runs, ATX
 * heading, block quote, bullet, thematic break, setext underline, table row,
 * HTML block, and the ordered-list marker. A backslash escape makes the first
 * character literal and renders invisibly — **except for an ordered list**,
 * whose marker is a digit, and a digit is not escapable; there the escape goes
 * before the `.` or `)` that completes the marker, which is the documented way
 * to write a line beginning with a number.
 *
 * A visible backslash in the raw bytes is the accepted cost. A `SKILL.md` is
 * read as raw text by a model at least as often as it is rendered, and a
 * stray backslash is a far smaller lie than a heading its author did not write.
 */
function neutralizeBlockStart(line: string): string {
  const ordered = /^(\d{1,9})([.)])/u.exec(line);
  if (ordered !== null) {
    return `${ordered[1] ?? ""}\\${line.slice((ordered[1] ?? "").length)}`;
  }
  return /^[`~#>|<*+\-=_]/u.test(line) ? `\\${line}` : line;
}

/**
 * Payload prose: capped as a whole, exactly as a single-line field is.
 *
 * The cap is applied to the joined block rather than to each paragraph, because
 * a per-paragraph bound is not a bound — inserting blank lines raises it without
 * limit, which is how the first version of this split turned `FIELD_CAP` from a
 * field bound into a paragraph bound. Found by the same review.
 */
function boundedProse(value: string): string {
  return capGraphemes(paragraphsOf(value).join("\n\n"), FIELD_CAP);
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
  const paragraphs = paragraphsOf(value);
  if (paragraphs.join("\n\n").length > FIELD_CAP) {
    throw new Error(
      `one of the shared workflow's ${field} values is longer than ${String(FIELD_CAP)} characters once screened; the preamble carries the prompt-injection defence and is refused rather than truncated. The bound is per value, not over the whole preamble`,
    );
  }
  return paragraphs;
}

function screenOrRefuse(value: string, field: string): string {
  const screened = screenControlCharacters(value);
  if (screened.length > FIELD_CAP) {
    throw new Error(
      `one of the shared workflow's ${field} values is longer than ${String(FIELD_CAP)} characters once screened; the preamble carries the prompt-injection defence and is refused rather than truncated. The bound is per value, not over the whole preamble`,
    );
  }
  return screened;
}

/**
 * A payload containing its own fence closes the block early and swallows every
 * line after it. CommonMark closes a fence only on a run at least as long as the
 * opening one, so open with a run longer than the longest inside. Presentation
 * rather than execution, and still a structure a hostile value could otherwise
 * choose.
 */
function fenced(payload: string, info: string): readonly string[] {
  const longest = [...payload.matchAll(/`+/gu)].reduce(
    (max, [run]) => Math.max(max, run.length),
    0,
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [`${fence}${info}`, payload, fence];
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
    /**
     * Per scope, not in total. A combined check passed on the refusals alone,
     * so a `shared` whose prose screened to nothing — whitespace, or a single
     * format character — shipped six artifacts carrying refusals and no
     * defence, with no error. Second review, same day, same class of defect as
     * the empty-preamble check it strengthens.
     */
    if (preambleProse(dependencies.shared).length === 0) {
      throw new Error(
        "the shared workflow's preamble prose is empty; it carries the prompt-injection defence and every other artifact depends on it being non-empty",
      );
    }
  }

  /**
   * The overlay is **applied**, not discarded.
   *
   * It used to be `void overlay`, so a caller who passed one lost it silently
   * and no test failed — while spec §7 says the input is a contract plus its
   * optional Claude overlay. `applyOverlay` is the compiler's own merge and the
   * only thing that knows an overlay is presentation-only; re-implementing the
   * rule here is how the two come to disagree. A refused overlay throws, because
   * rendering the base contract instead would silently produce an artifact the
   * caller did not ask for. Found by fresh-context review of Tasks 1–5.
   *
   * `OverlayOutcome.lifecycle` is deliberately unused: DOS-P4 emits no hook
   * artifact at all (spec §6, amended 2026-08-11), so there is nothing for a
   * lifecycle binding to bind to. Owner of the restoration: DOS-P6.
   */
  render(
    contract: WorkflowContractV1,
    overlay: WorkflowOverlayV1 | null,
  ): readonly RenderedArtifact[] {
    assertRenderable(contract);
    const rendered = this.#applied(contract, overlay);
    // Again, on the object the path is actually built from. `applyOverlay`
    // cannot move `id` or `version` today; the assertion is local to the value
    // it protects rather than to the one that preceded it.
    assertRenderable(rendered);
    const lines: string[] = [
      "---",
      `name: ${yamlScalar(`developer-os-${rendered.id}`)}`,
      `description: ${yamlScalar(rendered.description)}`,
      "---",
      "",
      `<!-- ${sourceMarker(rendered, `workflows/${rendered.id}/workflow.yaml`)} -->`,
      "",
    ];

    if (rendered.id !== SHARED_WORKFLOW_ID) {
      lines.push(...this.#preamble(), "");
    }

    lines.push(`# ${screen(rendered.id)}`, "");
    lines.push(...renderRefusals(rendered), "");
    lines.push(...renderSteps(rendered), "");
    lines.push(...renderRecovery(rendered));

    return [
      {
        path: `skills/developer-os-${rendered.id}/SKILL.md`,
        contents: `${lines.join("\n")}\n`,
      },
    ];
  }

  #applied(
    contract: WorkflowContractV1,
    overlay: WorkflowOverlayV1 | null,
  ): WorkflowContractV1 {
    if (overlay === null) return contract;
    /**
     * An overlay on `shared` is refused rather than applied. The preamble has
     * one reviewable home and is concatenated into five other artifacts from
     * `this.#shared`, which no overlay reaches — so an overlaid `shared` skill
     * would state one defence while the five copies stated another. Second
     * review, 2026-08-11.
     */
    if (contract.id === SHARED_WORKFLOW_ID) {
      throw new Error(
        "the Claude overlay was refused: the shared workflow carries the prompt-injection defence concatenated into every other artifact, and an overlay would make the copies disagree",
      );
    }
    const outcome = applyOverlay(contract, overlay);
    if (!outcome.ok) {
      // Screened: `applyOverlay` screens a step id but leaves `extends`
      // unscreened, because its schema constrains it — and `render` is typed
      // rather than parsed, so nothing here has run that schema.
      throw new Error(`the Claude overlay was refused: ${screen(outcome.reason)}`);
    }
    return outcome.contract;
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
    ...renderRefusals(shared, (message) =>
      screenOrRefuse(message, "refusal message"),
    ),
    ...preambleProse(shared),
  ];
}

/** The prose half alone, so the constructor can require *this* scope non-empty. */
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
      const block = boundedProse(step.prose);
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
    boundedProse(contract.recovery.leaves),
    "",
    "Do not run this automatically. It is text for a person to read:",
    "",
    ...fenced(screen(contract.recovery.resume), "text"),
  ];
}
