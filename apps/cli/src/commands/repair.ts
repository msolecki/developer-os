import { join } from "node:path";

import {
  EXIT_CODES,
  failure,
  recoverTransaction,
  success,
  TransactionBackupRetentionError,
} from "@developer-os/core";
import type { CliResult, TransactionJournalV1 } from "@developer-os/core";

import { failureFrom } from "../context.js";
import type { CliContext } from "../context.js";

const JOURNAL_ID = /^[A-Za-z0-9._-]+$/;

export interface RepairResultV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly action: "resumed" | "rolled_back";
  readonly phase: "finalized" | "rolled_back";
}

export interface RepairOptions {
  readonly resume: string | null;
  readonly rollback: string | null;
}

function invalid(message: string, paths: readonly string[] = []): CliResult<never> {
  return failure(EXIT_CODES.invalidInput, {
    kind: "invalid_input",
    message,
    paths,
    recovery: "developer-os doctor",
  });
}

function journalPath(context: CliContext, id: string): string {
  return join(context.paths.stateDir, "transactions", `${id}.json`);
}

async function readRecoverable(
  context: CliContext,
  id: string,
): Promise<TransactionJournalV1 | null> {
  try {
    await context.fs.lstat(journalPath(context, id));
  } catch {
    return null;
  }
  return context.transactions.read(id);
}

/**
 * Recovery is a decision, not a guess: `repair` performs exactly the action the caller
 * named and refuses everything else.
 *
 * **A terminal phase is not by itself invalid input**, and this paragraph used to say it
 * was — while the block inside said the opposite for half the cases, which is the version a
 * reader meets second. Re-running the action a transaction already completed is an
 * idempotent sweep of its backup payloads; naming the *other* action is the invalid one.
 * See the gate below for which is which.
 */
export async function runRepair(
  context: CliContext,
  options: RepairOptions,
): Promise<CliResult<RepairResultV1>> {
  const id = options.resume ?? options.rollback;

  if (options.resume !== null && options.rollback !== null) {
    return invalid("repair accepts exactly one of --resume and --rollback");
  }
  if (id === null) {
    return invalid("repair requires --resume <id> or --rollback <id>");
  }
  if (!JOURNAL_ID.test(id)) {
    return invalid("the transaction identifier is not a valid identifier");
  }

  try {
    const journal = await readRecoverable(context, id);
    if (journal === null) {
      return invalid("no transaction with that identifier exists", [
        journalPath(context, id),
      ]);
    }
    /**
     * **A terminal phase is refused for the *other* action and accepted for its own**, and
     * getting that rule to the second half took two rounds of review.
     *
     * The executor prunes each transaction's backup payloads immediately after the
     * transition into a terminal phase. A process that dies between the two leaves a
     * journal reading `finalized` or `rolled_back` with the payload — possibly the secret
     * the user just asked to remove — still on disk. Both terminal early-returns in the
     * executor prune, so both windows have a sweep; this gate is what lets a user reach it.
     *
     * Refusing a terminal phase outright made those sweeps unreachable from the product.
     * The first fix opened `--resume` on `finalized` and left `--rollback` on `rolled_back`
     * shut, which is the same defect surviving on the mirror side — and `ORDER.md` claimed
     * the window was swept while this file refused the command that would sweep it.
     *
     * What stays refused is the cross pairing, because the executor throws on it:
     * `resumeLocked` raises on a rolled-back journal, `rollbackLocked` on a finalized one.
     * Naming one of those is genuinely invalid input rather than an idempotent no-op
     * (BACKLOG, Foundation request 2).
     */
    const resuming = options.resume !== null;
    const opposite = resuming ? "rolled_back" : "finalized";
    if (journal.phase === opposite) {
      return invalid(
        `transaction ${id} already reached phase ${journal.phase}`,
        [journalPath(context, id)],
      );
    }

    const outcome = await recoverTransaction({
      executor: context.executor,
      id,
      action: resuming ? "resume" : "rollback",
    });

    return success({
      schemaVersion: 1,
      id: outcome.id,
      action: outcome.action,
      phase: outcome.phase,
    });
  } catch (error) {
    /**
     * **The retention error is the one failure here that names its own fix**, so it is the
     * one that carries a `recovery`. Without this field the rendered failure was an exit
     * code, a kind and a sentence, leaving the user to already know the route.
     *
     * **The precondition comes first, and the first version of this left it out.** It said
     * re-running the command was the remedy, reasoning that `pruneBackups` is idempotent —
     * but idempotent means retrying is *safe*, not that it will work. The only thing that
     * raises this is an `unlink` failing for a reason other than "already gone", and that
     * reason survives the retry: a probe re-ran the recovery and got the identical error.
     * A recovery string that cannot succeed is worse than none.
     *
     * It is spelled out rather than left to the message because `redactDiagnostic` rewrites
     * paths, and the payload path inside the message is precisely the kind of string it
     * rewrites. The route has to survive that; the path does not have to.
     */
    if (error instanceof TransactionBackupRetentionError) {
      /**
       * **The directory is published in `paths`, and leaving it out made the recovery
       * unfollowable.** The payload path exists only inside the message, `redactDiagnostic`
       * rewrites it — production ids are `tx_${randomUUID()}`, which is exactly what its
       * high-entropy rule catches — and the only path this catch published was the
       * *journal*, under `state/`. A user who did what the recovery said made
       * `state/transactions/` writable and nothing changed.
       */
      return failureFrom(
        context,
        error,
        [error.directory],
        `make the backup directory writable, then: developer-os repair ${options.resume !== null ? "--resume" : "--rollback"} ${id}`,
      );
    }
    return failureFrom(context, error, [journalPath(context, id)]);
  }
}
