import { TransactionStateError } from "./store.js";
import type {
  TransactionRecoveryRequest,
  TransactionRecoveryResult,
} from "./types.js";

export async function recoverTransaction(
  request: TransactionRecoveryRequest,
): Promise<TransactionRecoveryResult> {
  if (request.action === "resume") {
    const journal = await request.executor.resume(request.id);
    if (journal.phase !== "finalized") throw new TransactionStateError();
    return { id: request.id, action: "resumed", phase: "finalized" };
  }

  const journal = await request.executor.rollback(request.id);
  if (journal.phase !== "rolled_back") throw new TransactionStateError();
  return { id: request.id, action: "rolled_back", phase: "rolled_back" };
}
