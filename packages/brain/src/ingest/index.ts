/**
 * Ingest: the prompt one accepted capture becomes, and the parser for what a
 * model returns.
 *
 * Pure functions, with the same property the `capture/` and `review/`
 * directories hold — **nothing here touches a filesystem, an environment, a
 * process, a clock or a key.** The adapter call, the transaction that writes
 * staging, and the nine validators of spec §6.3 all belong outside this
 * package.
 *
 * **The invocation this directory is built for, specified rather than wired.**
 * `packages/brain` depends on `core` and `security` only, so nothing here can
 * reach an adapter or `resolveScopeGlob`. `apps/cli/src/commands/ingest.ts`
 * owns the call and passes:
 *
 * ```ts
 * { read: [resolveScopeGlob("content/**", brainConfig)], write: [] }
 * ```
 *
 * **That read scope is wider than `ingest.stage`'s declared footprint, and the
 * two are not the same kind of statement.** `EFFECT_VOCABULARY` gives
 * `ingest.stage` `read: content/_raw/quarantine/**` — the files *Developer OS*
 * itself opens to perform the step. The literal above is the *model's* sandbox,
 * and spec §6.2 sets it deliberately wider: "the agent has read-only access to
 * the vault", because a model that cannot see the vault cannot propose notes
 * that link to existing ones or notice it is duplicating one. Nothing is
 * over-declared by this — a declared footprint is not a permission set, and the
 * write side carries the same distinction for Task 12, where the workflow's
 * declared write scopes describe what Developer OS writes across the workflow
 * rather than what the model was ever allowed to do.
 *
 * **Zero write scopes, and the sandbox follows from the count rather than
 * from an argument.** `invokeCodex` derives `-s read-only` from
 * `writeScopes.length === 0`, and the Claude side passes no write tool in
 * `--allowedTools`. That is what makes "the model cannot write outside
 * staging" a property the vendor's own sandbox enforced *before* the model
 * ran, rather than one our validators must prove afterwards (spec §3.3). The
 * `--output-schema` the same call names is the file `init` installs; its path
 * comes from `outputSchemaPath` in `apps/cli/src/commands/output-schemas.ts`,
 * because `invokeCodex` only screens that path and never writes it.
 *
 * The agent gets read-only access to a vault that may contain secrets the user
 * wrote into their own notes. Redacting the user's canonical content is not
 * this product's business; catching it on the way back is, and that is the
 * secret scan among the nine validators.
 */
export {
  MAX_PROPOSED_NOTE_CHARS,
  MAX_PROPOSED_NOTES,
  MAX_PROPOSED_PATH_CHARS,
  parseIngestProposal,
} from "./proposal.js";
export type {
  IngestProposal,
  IngestProposalOutcome,
  IngestProposalRefusal,
  ProposedNote,
} from "./proposal.js";
export { buildIngestPrompt, MAX_PROMPT_CONTENT_GRAPHEMES } from "./prompt.js";
export type { IngestPromptOptions } from "./prompt.js";
