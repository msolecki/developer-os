/**
 * The scheduled-job marker: which registry job's handler the current async scope runs under.
 * A leaf module, because the runner sets it and the vendor door (`invokeAgentOnce`) reads it, and
 * runner → handlers → garden → ingest would make ingest → runner an import cycle.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { ScheduledJobIdV1 } from "@developer-os/core";

const scope = new AsyncLocalStorage<ScheduledJobIdV1>();

export function withScheduledJob<T>(job: ScheduledJobIdV1, fn: () => Promise<T>): Promise<T> {
  return scope.run(job, fn);
}

/** The job whose scheduled handler is running; undefined outside a scheduled run (a manual command). */
export function currentScheduledJob(): ScheduledJobIdV1 | undefined {
  return scope.getStore();
}
