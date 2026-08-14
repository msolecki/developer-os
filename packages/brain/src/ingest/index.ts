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
 * **The invocation this directory was built for, as it was actually wired.**
 * `packages/brain` depends on `core` and `security` only, so nothing here can
 * reach an adapter or `resolveScopeGlob`. `apps/cli/src/commands/ingest.ts`
 * owns the call, and DOS-P6 Task 13 is the task that made it — so this
 * paragraph is a record rather than the specification-in-advance it was written
 * as.
 *
 * **Neither `ClaudeInvocation` nor `CodexInvocation` has a read-scope field**,
 * so no glob is passed to either CLI. Each vendor expresses the read side in
 * its own vocabulary and the command speaks each one:
 *
 * - **Codex** gets `workingRoot` — the resolved content root as a directory —
 *   and `-s read-only`, which `invokeCodex` derives from
 *   `writeScopes.length === 0` rather than from an argument.
 * - **Claude** gets an `allowedTools` list carrying read tools and no write
 *   tool. There is no `--output-schema` on that side either, so the schema is
 *   described in the prompt and enforced by `parseIngestProposal` afterwards.
 *
 * The read scope is therefore the *sandbox*, not a string handed over: the
 * resolved `content/**` glob is what Developer OS declares it reads, and the
 * declaration and the enforcement are two different artifacts. Only the **write**
 * side crosses as a value — `writeScopes: []` — and it is the count that matters.
 *
 * **That declared read scope is wider than `ingest.stage`'s declared footprint,
 * and the two are not the same kind of statement.** `EFFECT_VOCABULARY` gives
 * `ingest.stage` `read: content/_raw/quarantine/**` — the files *Developer OS*
 * itself opens to perform the step. What the sandbox described above grants is
 * the *model's* reach, and spec §6.2 sets it deliberately wider: "the agent has
 * read-only access to the vault", because a model that cannot see the vault
 * cannot propose notes that link to existing ones or notice it is duplicating
 * one. Nothing is over-declared by this — a declared footprint is not a
 * permission set.
 *
 * **The write side carries the same distinction, and it is now code.** After
 * Task 7 the `ingest` contract declares `write: [content/**, content/_indexes/**]`,
 * which describes what *Developer OS* writes across the whole workflow — the
 * indexes directory is in there because the `reindex` step writes it. What the
 * *model* may propose is strictly narrower, so `validateProposal`'s
 * `write-scope` treats the declared set as an **upper bound and subtracts**
 * generated outputs and private folders from it: `_indexes/index.json` and
 * `_raw/quarantine/evil.md` are both inside the declared globs and both
 * refused. "The same globs by construction" would be the natural reading and it
 * is false; the bound is still consulted, which is why narrowing the contract
 * to `content/QA/**` refuses a note in `DEV/`.
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
export { planIngestApply } from "./apply.js";
export type { ApplyResult, PlannedNoteWriteV1 } from "./apply.js";
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
export { validateProposal, VALIDATOR_IDS } from "./validate.js";
export type {
  IngestValidationContext,
  IngestValidationFinding,
  IngestValidationResult,
  ValidatorId,
} from "./validate.js";
