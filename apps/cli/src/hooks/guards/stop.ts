import { join } from "node:path";

import { capUtf8Bytes } from "../outcome.js";
import { resolveProjectRoot } from "../project-root.js";
import type { HookVerbHandler } from "../registry.js";
import { HOOK_CHILD_ENV, isRegularFile, localBin, TSC_TIMEOUT_MS } from "./child.js";

const MAX_DIAGNOSTIC_LINES = 40;
const MAX_DIAGNOSTIC_BYTES = 1800;

export const guardStop: HookVerbHandler = async (payload, runtime) => {
  if (payload.stopHookActive !== false) return { kind: "allow" };
  const root = await resolveProjectRoot(runtime.cwd);
  if (!(await isRegularFile(join(root, "tsconfig.json")))) return { kind: "allow" };
  const script = await localBin(root, "tsc");
  if (script === null) return { kind: "allow" };
  const checkConfig = join(root, "tsconfig.check.json");
  const config = (await isRegularFile(checkConfig)) ? checkConfig : join(root, "tsconfig.json");
  let result;
  try {
    result = await runtime.runner.run({
      executable: runtime.nodeExecutable,
      args: [script, "--noEmit", "-p", config],
      cwd: root,
      stdin: "",
      timeoutMs: TSC_TIMEOUT_MS,
      env: HOOK_CHILD_ENV,
    });
  } catch {
    return { kind: "allow", note: "typecheck could not run" };
  }
  if (result.timedOut) return { kind: "allow", note: `typecheck timed out after ${String(TSC_TIMEOUT_MS)} ms` };
  if (result.exitCode === null) return { kind: "allow", note: "typecheck ended without an exit code" };
  if (result.exitCode === 0) return { kind: "allow" };
  const diagnostics = `${result.stdout}\n${result.stderr}`
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, MAX_DIAGNOSTIC_LINES)
    .join("\n");
  return { kind: "block", ruleId: "typecheck", detail: capUtf8Bytes(diagnostics, MAX_DIAGNOSTIC_BYTES) };
};
