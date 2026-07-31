import { join } from "node:path";

import { EXIT_CODES, failure, recoverTransaction, success } from "@developer-os/core";
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
 * Recovery is a decision, not a guess: `repair` performs exactly the action the
 * caller named and refuses everything else. A transaction that already reached a
 * terminal phase has nothing to recover, so naming one is invalid input rather
 * than a silent success.
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
    if (journal.phase === "finalized" || journal.phase === "rolled_back") {
      return invalid(
        `transaction ${id} already reached phase ${journal.phase}`,
        [journalPath(context, id)],
      );
    }

    const outcome = await recoverTransaction({
      executor: context.executor,
      id,
      action: options.resume === null ? "rollback" : "resume",
    });

    return success({
      schemaVersion: 1,
      id: outcome.id,
      action: outcome.action,
      phase: outcome.phase,
    });
  } catch (error) {
    return failureFrom(context, error, [journalPath(context, id)]);
  }
}
