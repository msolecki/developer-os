import { screenAndCap, screenControlCharacters } from "@developer-os/security";

import type { WorkflowContractV1 } from "./contract.js";
import { workflowContractSchema } from "./contract.js";
import { compareScopes, deriveScopes } from "./derive.js";
import { lookupVerb } from "./vocabulary.js";

export type WorkflowSeverity = "error" | "warn" | "info";

export interface WorkflowFinding {
  readonly file: string;
  readonly stepId: string | null;
  readonly rule: string;
  readonly severity: WorkflowSeverity;
  readonly message: string;
}

export interface WorkflowValidationResult {
  readonly findings: readonly WorkflowFinding[];
  readonly errorCount: number;
  readonly warnCount: number;
  readonly infoCount: number;
  /** `null` when the contract did not parse; there is nothing to hand a renderer. */
  readonly contract: WorkflowContractV1 | null;
}

/**
 * The bound is on the **fragment**, not the sentence.
 *
 * Everything interpolated into a message — a verb, a glob, a step id, a schema
 * path — is author-controlled, unbounded, and reaches a terminal and a log, so
 * it is screened and capped before it gets there. The surrounding words are ours
 * and carry the whole point of the finding: an earlier version capped the
 * assembled message instead, which cut the `scheduled` refusal off at
 * "the scheduler is la" and deleted the `DOS-P7` that tells an author where the
 * feature actually lives.
 *
 * `MAX_MESSAGE` is a backstop for the one message built mostly out of library
 * text — a zod issue, whose wording includes author-written key names.
 */
const MAX_FRAGMENT = 64;
const MAX_MESSAGE = 512;
/** A path needs more room than a value, and still needs a bound. */
const MAX_PATH = 256;

/** An author-controlled value: screened, then capped hard. */
function fragment(text: string): string {
  return screenAndCap(text, MAX_FRAGMENT);
}

/** An assembled message: always screened, capped only as a backstop. */
function message(text: string): string {
  return screenAndCap(text, MAX_MESSAGE);
}

/**
 * The one hole in `.strict()`, and the schema structurally cannot close it.
 * `zod@4.4.3` skips a `__proto__` key in both its object and its record parser
 * *before* the unknown-key check runs, so the single field name that must never
 * be ignored was the only one that was: a `workflow.yaml` carrying `__proto__:`
 * at the root, inside a step, and as an `inputs` key validated clean, with all
 * three keys gone from the parsed value.
 *
 * This is not prototype pollution — zod's skip is what prevents that — it is a
 * silent drop, which contradicts "unknown fields are refused, never ignored".
 * The refusal lives here rather than in the schema because here is the choke
 * point every caller goes through, file-loaded or hand-built.
 */
const RESERVED_KEY = "__proto__";

/**
 * A bound on how much structure this walk will look at. Exceeding it is
 * reported, never ignored — a silent `false` here would be a guard that answers
 * "no reserved key" precisely when it stopped looking.
 */
const MAX_NODES_SCANNED = 100_000;

type ReservedKeyScan = "clean" | "found" | "too-large";

/**
 * Iterative, with a visited set and a node budget, and it never invokes a
 * getter.
 *
 * The first version was a plain recursion over `Object.values`, and all three of
 * this task's reviewers landed on it independently: a circular object overflowed
 * the stack, so did roughly four thousand levels of nesting, and a throwing
 * getter propagated straight out. That made `validateWorkflow` non-total — the
 * very property `parse.ts` was corrected twice to preserve, and the one Task 8's
 * loader is built on. It is not reachable from a file, because
 * `parseWorkflowYaml` refuses the anchors that build a cycle and the depth that
 * exhausts the stack; it is reachable by any caller of this exported function,
 * which the contract explicitly supports.
 *
 * Descent goes through property *descriptors* rather than `Object.values`, so an
 * accessor is seen and not called.
 */
function scanForReservedKey(root: unknown): ReservedKeyScan {
  const seen = new WeakSet<object>();
  const pending: unknown[] = [root];
  let budget = MAX_NODES_SCANNED;

  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object") continue;
    if (seen.has(value)) continue;
    seen.add(value);

    budget -= 1;
    if (budget <= 0) return "too-large";

    if (Object.hasOwn(value, RESERVED_KEY)) return "found";

    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) continue;
      pending.push(descriptor.value);
    }
  }

  return "clean";
}

export function validateWorkflow(
  file: string,
  input: unknown,
): WorkflowValidationResult {
  const findings: WorkflowFinding[] = [];
  const add = (
    rule: string,
    severity: WorkflowSeverity,
    text: string,
    stepId: string | null = null,
  ): void => {
    findings.push({
      /**
       * Screened and bounded like everything else. It was passed through raw,
       * and a `workflows/` tree becomes user-extensible by design — at which
       * point a directory name is author-controlled, a U+202E in it reorders
       * every line a renderer prints after it, and its length is bounded by
       * nothing. A path needs more room than a value, hence its own bound.
       */
      file: screenAndCap(file, MAX_PATH),
      stepId: stepId === null ? null : fragment(stepId),
      rule,
      severity,
      message: message(text),
    });
  };

  const reserved = scanForReservedKey(input);
  if (reserved === "too-large") {
    add(
      "input-too-large",
      "error",
      `this input has more than ${String(MAX_NODES_SCANNED)} nodes, which is past the point where it can be checked for reserved keys; a workflow is a document, not a data set`,
    );
    return summarize(findings, null);
  }
  if (reserved === "found") {
    add(
      "reserved-key",
      "error",
      `\`${RESERVED_KEY}\` is not a field name; the schema would drop it without saying so, which is the one unknown key that cannot be reported as unknown`,
    );
    return summarize(findings, null);
  }

  const parsed = workflowContractSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      /**
       * The path is author-derived and capped; the issue text is the library's
       * and is only screened, because it is what names `DOS-P7`.
       */
      add(
        "schema",
        "error",
        `${fragment(issue.path.join(".")) || "<root>"}: ${screenControlCharacters(issue.message)}`,
      );
    }
    return summarize(findings, null);
  }

  const contract = parsed.data;
  const derived = deriveScopes(contract);

  /**
   * Walked per step rather than read off `derived.unknownVerbs`, which is a
   * *set* of verb strings and therefore drops two things spec §11 asks for: the
   * step id every finding is supposed to carry, and the second occurrence. Two
   * steps sharing one bad verb produced one finding, so an author fixed one and
   * met the same error again. It is the rule an author hits most often and it
   * was the only per-step rule with no step id on it.
   */
  const unknown = new Set(derived.unknownVerbs);
  for (const step of contract.steps) {
    if (step.do === undefined || !unknown.has(step.do.normalize("NFC"))) continue;
    add(
      "unknown-verb",
      "error",
      `\`${fragment(step.do)}\` is not in the effect vocabulary`,
      step.id,
    );
  }

  for (const mismatch of compareScopes(contract.scopes, derived)) {
    add(
      `scope-${mismatch.kind}`,
      "error",
      mismatch.kind === "under-declared"
        ? `${mismatch.axis} scope \`${fragment(mismatch.glob)}\` is derived from a step but not declared`
        : `${mismatch.axis} scope \`${fragment(mismatch.glob)}\` is declared but no step derives it`,
    );
  }

  const declaredRefusals = new Set(contract.refusals.map((refusal) => refusal.when));
  if (contract.capabilities.length > 0 && !declaredRefusals.has("capability-missing")) {
    add(
      "capability-refusal-missing",
      "error",
      "this workflow requires a capability and does not say what happens without it, which becomes a runtime surprise inside somebody's agent session",
    );
  }

  for (const step of contract.steps) {
    if (step.do === undefined) continue;
    const footprint = lookupVerb(step.do);
    if (footprint === undefined) continue;

    if (!footprint.implemented) {
      add(
        "unimplemented-verb",
        "info",
        `\`${fragment(step.do)}\` has no handler yet; owed by ${fragment(footprint.owner)}`,
        step.id,
      );
    }

    /**
     * Outside the branch above, deliberately. Whether a verb needs a capability
     * has nothing to do with whether its handler exists yet, and nesting this
     * check inside the unimplemented case made it unreachable for every verb
     * that does have one — `cli.run` among them.
     */
    if (
      footprint.capability !== null &&
      !contract.capabilities.includes(footprint.capability)
    ) {
      add(
        "capability-undeclared",
        "error",
        `\`${fragment(step.do)}\` needs the \`${footprint.capability}\` capability and the workflow does not declare it`,
        step.id,
      );
    }
  }

  return summarize(findings, contract);
}

function summarize(
  findings: readonly WorkflowFinding[],
  contract: WorkflowContractV1 | null,
): WorkflowValidationResult {
  return {
    findings,
    errorCount: findings.filter((finding) => finding.severity === "error").length,
    warnCount: findings.filter((finding) => finding.severity === "warn").length,
    infoCount: findings.filter((finding) => finding.severity === "info").length,
    contract,
  };
}
