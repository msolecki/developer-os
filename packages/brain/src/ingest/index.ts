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
 * so no glob is passed to either CLI. That used to mean each vendor expressed
 * the read side in its own vocabulary; since 27771d2 it means Codex still
 * does and Claude expresses none at all — an empty tool set is the absence of
 * a read vocabulary, not a second one:
 *
 * - **Codex** gets `workingRoot` — the resolved content root as a directory —
 *   and `-s read-only`, which `invokeCodex` derives from
 *   `writeScopes.length === 0` rather than from an argument.
 * - **Claude** gets `--tools ""` — an empty tool set, not a grant list; the
 *   model reaches no file through a tool call on this side at all. There is no
 *   `--output-schema` on that side either, so the schema is described in the
 *   prompt and enforced by `parseIngestProposal` afterwards.
 *
 * **For Codex, the read scope is therefore the *sandbox*, not a string handed
 * over:** the resolved `content/**` glob is what Developer OS declares it
 * reads, and the declaration and the enforcement are two different artifacts.
 * Claude has no sandbox-conferred read scope to compare against — since
 * 27771d2 it instead receives a bounded, screened excerpt of the vault's index
 * (`IngestPromptOptions.indexExcerpt`, `./prompt.ts`: path, title and summary
 * per note, capped and rendered as prompt text), never a filesystem grant.
 * `writeScopes: []` crosses as a value on the Codex call only — `ClaudeInvocation`
 * has no `writeScopes` field, because its zero tools already admit no write
 * regardless of any count.
 *
 * **That declared read scope is wider than `ingest.stage`'s declared footprint,
 * and the two are not the same kind of statement — for Codex.** `EFFECT_VOCABULARY`
 * gives `ingest.stage` `read: content/_raw/quarantine/**` — the files *Developer OS*
 * itself opens to perform the step. What Codex's sandbox grants is that vendor's
 * model's reach, and spec §6.2 sets it deliberately wider: "the agent has
 * read-only access to the vault", because a model that cannot see the vault
 * cannot propose notes that link to existing ones or notice it is duplicating
 * one. Nothing is over-declared by this — a declared footprint is not a
 * permission set. **Claude's reach is narrower than spec §6.2 describes**,
 * deliberately, since 27771d2: the index excerpt carries three fields of
 * already-indexed notes, not the vault itself.
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
 * **Zero write scopes, and Codex's sandbox follows from the count rather than
 * from an argument.** `invokeCodex` derives `-s read-only` from
 * `writeScopes.length === 0`. Claude carries no count to derive anything from:
 * since 349511e it is invoked with `--tools ""` — an explicit empty tool set,
 * not a write tool withheld from an allow-list, because there is no allow-list
 * left (`--allowedTools` is gone from this call entirely) — plus
 * `--strict-mcp-config --restricted --safe-mode --no-session-persistence
 * --permission-prompts none` (`packages/adapter-claude/src/invoke.ts`). Either
 * way, "the model cannot write outside staging" is a property the vendor's own
 * invocation enforced *before* the model ran, rather than one our validators
 * must prove afterwards (spec §3.3). The `--output-schema` the same call names
 * is the file `init` installs; its path comes from `outputSchemaPath` in
 * `apps/cli/src/commands/output-schemas.ts`, because `invokeCodex` only
 * screens that path and never writes it.
 *
 * **Codex's agent gets read-only access to a vault that may contain secrets
 * the user wrote into their own notes; Claude's does not, since 27771d2 — it
 * gets the bounded index excerpt above.** That asymmetry is why the excerpt
 * gets a redaction pass Codex's raw vault access never did: `readIndexExcerpt`
 * (`apps/cli/src/commands/ingest.ts`) runs `path`, `title` and `summary`
 * through the run's own redactor before returning them, on read from disk,
 * for the same reason `packages/brain/src/capture/parse.ts` re-redacts a
 * capture body on read — a hand edit to a vault note is how a secret or a
 * configured client name gets into on-disk text, and the index is that same
 * class of text. Only after that does `./prompt.ts` screen the already-redacted
 * fields for prompt-injection shape (`boundedProse`) and cap and fence them;
 * screening and redaction are two different mechanisms with two different
 * owners, and the excerpt gets both.
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
export {
  buildIngestPrompt,
  MAX_PROMPT_CONTENT_GRAPHEMES,
  MAX_PROMPT_INDEX_GRAPHEMES,
} from "./prompt.js";
export type { IndexExcerptEntryV1, IngestPromptOptions } from "./prompt.js";
export { validateProposal, VALIDATOR_IDS } from "./validate.js";
export type {
  IngestValidationContext,
  IngestValidationFinding,
  IngestValidationResult,
  ValidatorId,
} from "./validate.js";
