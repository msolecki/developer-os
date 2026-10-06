/**
 * The `git` command's CLI entry: admits a V2 home, takes the global mutation lock for every
 * apply and sync — so the service never acquires it a second time — and renders the result.
 */
import { EXIT_CODES, GIT_ENABLE_BRANCH_HISTORY_WARNING, failure, success } from "@developer-os/core";
import type { CliResult } from "@developer-os/core";

import { failureFrom, renderPath } from "../../context.js";
import type { CliContext } from "../../context.js";
import { V2HomeAdmissionError } from "../../lifecycle/admission.js";
import { admitV2Home, withGlobalLock } from "../../lifecycle/command-home.js";
import type { CliLifecycleContext } from "../../lifecycle/context.js";
import { LifecycleMutationRefusal } from "../../lifecycle/mutation-gate.js";
import { createGitService, GitCommandRefusal } from "./service.js";
import type { GitCommandDataV1, GitCommandRequestV1, GitCommandResultV1 } from "./service.js";

export type { GitCommandDataV1, GitCommandRequestV1, GitCommandResultV1 } from "./service.js";
export { createGitService } from "./service.js";
export type { GitService } from "./service.js";

async function execute(context: CliContext, lifecycle: CliLifecycleContext, request: GitCommandRequestV1): Promise<GitCommandResultV1> {
  const service = createGitService(context, lifecycle);
  switch (request.subcommand) {
    case "status":
      return service.status();
    case "sync":
      return withGlobalLock(context, lifecycle, (global) => service.sync("interactive", global));
    case "enable": {
      const preview = await service.previewEnable({ remote: request.remote, branch: request.branch });
      if (!request.apply) {
        return {
          exitCode: EXIT_CODES.success,
          data: { kind: "preview", command: "git_enable", preview, warning: GIT_ENABLE_BRANCH_HISTORY_WARNING },
        };
      }
      return withGlobalLock(context, lifecycle, (global) => service.applyEnable(preview, global));
    }
    case "disable": {
      const preview = await service.previewDisable();
      if (!request.apply) {
        return { exitCode: EXIT_CODES.success, data: { kind: "preview", command: "git_disable", preview, warning: null } };
      }
      return withGlobalLock(context, lifecycle, (global) => service.applyDisable(preview, global));
    }
  }
}

function refusalPathsOf(error: unknown): readonly string[] {
  return error instanceof V2HomeAdmissionError || error instanceof LifecycleMutationRefusal || error instanceof GitCommandRefusal
    ? error.paths
    : [];
}

export async function runGit(context: CliContext, request: GitCommandRequestV1): Promise<CliResult<GitCommandDataV1>> {
  try {
    const result = await execute(context, await admitV2Home(context), request);
    if (result.exitCode === EXIT_CODES.success) return success(result.data);
    // Only `sync` returns a non-success exit code: a pending push, whose coordinator and head the retry needs.
    const { data } = result;
    return failure(result.exitCode, {
      kind: "push_pending",
      message: "the push did not complete; the local commit is kept and the prior sync record is unchanged",
      paths: [context.paths.home].map((path) => context.guards.redactDiagnostic(path, "path")),
      recovery: "developer-os git sync",
      ...(data.kind === "sync"
        ? { data: context.guards.redactData({ transactionId: data.transactionId, headOid: data.headOid }) }
        : {}),
    });
  } catch (error) {
    const recovery = error instanceof GitCommandRefusal || error instanceof LifecycleMutationRefusal ? error.recovery : undefined;
    return failureFrom(context, error, refusalPathsOf(error), recovery);
  }
}

export function renderGit(data: GitCommandDataV1): readonly string[] {
  switch (data.kind) {
    case "preview": {
      const { preview } = data;
      const git = preview.git;
      const lines = [
        `Git plan ${preview.executionOperation} (${preview.previewHash}):`,
        ...(git === null
          ? []
          : [
              `  repository   ${git.repositoryMode} ${renderPath(git.repositoryRoot)}`,
              `  branch       ${git.branch}`,
              `  remote       ${git.remote.name} ${renderPath(git.remote.effectivePushUrl)}`,
              ...git.changes.map((change) => `  ${change.operation.padEnd(8)} ${renderPath(change.targetPath)}`),
            ]),
        ...preview.files.map((change) => `  ${change.operation.padEnd(8)} ${renderPath(change.targetPath)}`),
      ];
      if (data.warning !== null) lines.push(data.warning);
      lines.push("Nothing was changed. Run the same command with --apply to apply this plan.");
      return lines;
    }
    case "applied":
      return [`Git ${data.operation} applied (${data.transactionId}).`];
    case "status":
      return [
        `enabled        ${data.enabled ? "yes" : "no"}`,
        `activation     ${data.activation}`,
        `repository     ${data.repositoryRoot === null ? "-" : renderPath(data.repositoryRoot)}`,
        `branch         ${data.branch ?? "-"}`,
        `remote         ${data.remote === null ? "-" : renderPath(data.remote)}`,
        `scope          ${data.scope ?? "-"}`,
        `distribution   ${data.distribution ?? "-"}`,
        `lifecycle      ${data.closure}`,
        `last sync      ${data.lastSync === null ? "never" : `${data.lastSync.outcome} ${data.lastSync.headOid} at ${data.lastSync.completedAt}`}`,
      ];
    case "sync":
      return [`Git sync ${data.outcome} at ${data.headOid} (${data.transactionId}).`];
  }
}
