import { z } from "zod";

export interface AgentPromptArgs {
  readonly prompt: string;
  readonly maxTurns: number;
}

export type AgentPromptOutcome =
  | { readonly ok: true; readonly args: AgentPromptArgs }
  | { readonly ok: false; readonly message: string };

/**
 * Bounded because an unbounded agentic loop inside a workflow with declared
 * scopes is a workflow whose cost and reach are decided by the model.
 */
const MAX_TURNS_CEILING = 50;
const DEFAULT_MAX_TURNS = 5;
const PROMPT_CEILING = 100_000;

const schema = z
  .object({
    prompt: z.string().min(1).max(PROMPT_CEILING),
    maxTurns: z
      .number()
      .int()
      .min(1)
      .max(MAX_TURNS_CEILING)
      .default(DEFAULT_MAX_TURNS),
  })
  .strict();

/**
 * The argument contract for the `agent.prompt` verb.
 *
 * `workflow-schema.md` §8.6 records the largest hole in the scope guarantee:
 * `steps[].with` is `z.record(z.string(), z.unknown())`, contributes nothing to
 * a derived footprint, and "whichever adapter first executes a verb owns
 * validating that verb's arguments; this package cannot, because it does not
 * know what any handler does with them."
 *
 * **It lives in `packages/core` rather than in an adapter**, because DOS-P4 and
 * DOS-P5 both execute this verb and two adapters with two argument schemas for
 * one verb is a workflow that validates against one vendor and not the other.
 * `packages/workflow-schema` would be the wrong home for the opposite reason:
 * it is the compiler, and it deliberately does not know what a handler does.
 *
 * The schema is not exported. `parseAgentPromptArgs` is the only door, for the
 * reason the `__proto__` check below exists — the schema alone is not the
 * guarantee.
 */
export function parseAgentPromptArgs(input: unknown): AgentPromptOutcome {
  try {
    return parse(input);
  } catch {
    // Total for any `unknown`, which the signature promises and the first
    // version did not deliver: a throwing getter, a hostile Proxy and a revoked
    // Proxy all escaped. Unreachable from parsed YAML, which carries no
    // accessors — but the type says `unknown`, and a validator that aborts on
    // one hostile input cannot report on the rest.
    return { ok: false, message: "agent.prompt arguments failed validation" };
  }
}

function parse(input: unknown): AgentPromptOutcome {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "agent.prompt arguments must be an object" };
  }

  // `zod@4.4.3` strips `__proto__` BEFORE its own strictness check, so a
  // hostile object carrying one passes `.strict()` and the key silently
  // disappears rather than being refused. `workflow-schema`'s `index.ts`
  // records the same defect. Screen first, then parse — and never remove this
  // on the grounds that `.strict()` covers it.
  if (Object.prototype.hasOwnProperty.call(input, "__proto__")) {
    return {
      ok: false,
      message: "agent.prompt arguments carry a reserved key",
    };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    // The rejected value is never echoed. A `with` block is author-controlled
    // and this message reaches a log.
    return { ok: false, message: "agent.prompt arguments failed validation" };
  }
  return { ok: true, args: parsed.data };
}
