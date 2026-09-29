import { isAbsolute } from "node:path";

import {
  decodePlannerJson,
  parseLowerHexSha256,
  PLANNER_WIRE_BOUNDS_V1,
  plannerJsonBytes,
  PlannerWireDecoder,
  PlannerWireEncoder,
  rejectUpdateStep,
} from "@developer-os/core";
import type { LowerHexSha256, PlannerWireBoundsV1, TargetVerificationPlanV1 } from "@developer-os/core";

import { SecurityRefusalError } from "../paths.js";
import type { Redactor } from "../redaction.js";
import { screenPlannerFrame } from "./planner-process.js";
import type { PlannerChildProcessV1, TargetPlannerSupervisorDependencies } from "./planner-process.js";

export type TargetVerifierSupervisorDependencies = TargetPlannerSupervisorDependencies;

export interface TargetVerifierRunRequestV1 {
  /** The verified target bundle's pinned runtime executable. */
  readonly runtime: string;
  /** An empty guarded directory. */
  readonly cwd: string;
  readonly plan: TargetVerificationPlanV1;
  /** The bounded read-only snapshot, framed like the planner request's JSON. */
  readonly snapshot: unknown;
  readonly inputBlobs: readonly Uint8Array[];
  /** What is left of the enclosing attempt's wall budget; the verifier never extends it. */
  readonly remainingMilliseconds: number;
}

/** Structurally the CLI's `TargetVerifierObservationV1`: a clean exit echoing the three digests. */
export interface TargetVerifierRunResultV1 {
  readonly exitCode: 0;
  readonly manifestHash: LowerHexSha256;
  readonly ownerPostimagesHash: LowerHexSha256;
  readonly migrationPostimagesHash: LowerHexSha256;
}

type Digests = Omit<TargetVerifierRunResultV1, "exitCode">;

const SAMPLE_INTERVAL_MILLISECONDS = 1_000;
const DIGEST_KEYS = ["manifestHash", "migrationPostimagesHash", "ownerPostimagesHash"] as const;

function refuse(message: string): never {
  throw new SecurityRefusalError(message);
}

/** The planner's closed wire, narrowed to the plan's own byte and time caps and zero output blobs. */
export function targetVerifierWireBounds(plan: TargetVerificationPlanV1): PlannerWireBoundsV1 {
  return {
    ...PLANNER_WIRE_BOUNDS_V1,
    requestJsonBytes: plan.inputBytes,
    inputBlobBytes: plan.inputBytes,
    stdinWireBytes: plan.inputBytes,
    resultJsonBytes: plan.stdoutBytes,
    outputBlobCount: 0,
    outputBlobBytes: 0,
    stdoutWireBytes: plan.stdoutBytes,
    stderrBytes: plan.stderrBytes,
    idleMilliseconds: plan.idleMilliseconds,
    wallMilliseconds: plan.wallMilliseconds,
  };
}

function digestsOf(value: unknown): Digests | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== DIGEST_KEYS.length || keys.some((key, index) => key !== DIGEST_KEYS[index])) return null;
  const input = value as Record<string, unknown>;
  try {
    return { manifestHash: parseLowerHexSha256(input.manifestHash), ownerPostimagesHash: parseLowerHexSha256(input.ownerPostimagesHash), migrationPostimagesHash: parseLowerHexSha256(input.migrationPostimagesHash) };
  } catch {
    return null;
  }
}

/**
 * Spec 2 §9.3/§9.4's target verifier: exactly one process of the signed bundle's verifier under
 * the plan's fixed read-only table: the pinned runtime, the verifier entrypoint, an empty cwd, no
 * environment, the planner's input framing, and one result frame echoing the three digests. A
 * breach of any byte, count, time, RSS, descendant, or secret bound kills the group and refuses
 * (exit 5; the cursor stays, so a re-run resumes the exact verifier). No capability scan runs at
 * spawn time: the repository graph gate is the only one (D72 Q4-A). A clean non-zero
 * exit, or a clean exit without a well-formed echo, is the verifier disagreeing: a rejection the
 * coordinator compensates. Digest equality itself is `runTargetVerifier`'s check.
 *
 * ponytail: a sibling of `TargetPlannerSupervisor`'s loop rather than a shared one; fold the two
 * into one parameterised supervisor if a third bundle process appears.
 */
export class TargetVerifierSupervisor {
  constructor(readonly dependencies: TargetVerifierSupervisorDependencies) {}

  async run(run: TargetVerifierRunRequestV1): Promise<TargetVerifierRunResultV1> {
    const { plan } = run;
    if ((plan.processCount as number) !== 1 || !(plan.readOnly as boolean)) refuse("Verifier plan is not the read-only single process");
    if (!isAbsolute(run.runtime) || !isAbsolute(run.cwd)) refuse("Verifier paths must be absolute");
    if (!Number.isSafeInteger(run.remainingMilliseconds) || run.remainingMilliseconds < 1) refuse("Verifier attempt budget is exhausted");
    const verifier = `${plan.release.bundleRoot}/${plan.verifierEntrypoint}`;

    const bounds = targetVerifierWireBounds(plan);
    const { redactor } = this.dependencies;
    const requestJson = plannerJsonBytes({ schemaVersion: 1, plan, snapshot: run.snapshot });
    // Built only from the validated plan and its own digests: hashes and product paths, never free text.
    screenPlannerFrame(redactor, requestJson, "path");
    for (const blob of run.inputBlobs) screenPlannerFrame(redactor, blob);
    // Frames the whole input before spawning, so an over-bound request never starts a process.
    const wire = new PlannerWireEncoder("input", bounds);
    const input: Uint8Array[] = [];
    try {
      input.push(wire.magic(), wire.json(requestJson), requestJson);
      for (const blob of run.inputBlobs) input.push(wire.blob(blob), blob);
      input.push(wire.end());
    } catch {
      refuse("Verifier input exceeds its bound");
    }

    const child = this.dependencies.spawn({ executable: run.runtime, args: [verifier], cwd: run.cwd, env: {} });
    const { exit, digests } = await this.#supervise(child, input, bounds, Math.min(bounds.wallMilliseconds, run.remainingMilliseconds), redactor);
    if (exit.signal !== null || exit.exitCode === null) refuse("Verifier was terminated");
    if (exit.exitCode !== 0 || digests === null) return rejectUpdateStep("update_verifier_rejected");
    return { exitCode: 0, ...digests };
  }

  async #supervise(
    child: PlannerChildProcessV1,
    input: readonly Uint8Array[],
    bounds: PlannerWireBoundsV1,
    wallMilliseconds: number,
    redactor: Redactor,
  ): Promise<{ readonly exit: { readonly exitCode: number | null; readonly signal: string | null }; readonly digests: Digests | null }> {
    const { setTimer, sample } = this.dependencies;
    // An object, not a `let`: TypeScript does not see closure assignments and would narrow it to `null`.
    const state: { failure: Error | null; running: boolean } = { failure: null, running: true };
    let cancelIdle: () => void = () => undefined;
    let cancelSample: () => void = () => undefined;
    const fail = (error: unknown): void => {
      if (state.failure !== null) return;
      state.failure = error instanceof SecurityRefusalError ? error : new SecurityRefusalError("Verifier output failed validation");
      child.kill();
    };
    const progress = (): void => {
      cancelIdle();
      cancelIdle = setTimer(() => {
        fail(new SecurityRefusalError("Verifier exceeded its idle deadline"));
      }, bounds.idleMilliseconds);
    };
    const cancelWall = setTimer(() => {
      fail(new SecurityRefusalError("Verifier exceeded its wall deadline"));
    }, wallMilliseconds);
    progress();
    const watch = (): void => {
      cancelSample = setTimer(() => {
        if (!state.running || child.pid === undefined) return;
        sample(child.pid).then((observed) => {
          if (observed === null || !state.running) return;
          if (observed.descendants > 0) fail(new SecurityRefusalError("Verifier started another process"));
          else if (observed.residentBytes > bounds.residentBytes) fail(new SecurityRefusalError("Verifier exceeded its resident memory bound"));
          else watch();
        }, fail);
      }, this.dependencies.sampleIntervalMilliseconds ?? SAMPLE_INTERVAL_MILLISECONDS);
    };
    watch();

    const write = async (): Promise<void> => {
      try {
        for (const chunk of input) {
          if (state.failure !== null) return;
          await child.write(chunk);
          progress();
        }
        if (state.failure === null) await child.endInput();
      } catch {
        if (state.failure === null) refuse("Verifier closed its input early");
      }
    };
    const read = async (): Promise<Digests | null> => {
      const decoder = new PlannerWireDecoder("output", bounds);
      let digests: Digests | null = null;
      for await (const chunk of child.stdout) {
        if (state.failure !== null) break;
        progress();
        for (const frame of decoder.push(chunk)) {
          if (frame.kind !== "json") continue;
          screenPlannerFrame(redactor, frame.payload);
          try {
            digests = digestsOf(decodePlannerJson(frame.payload, bounds.resultJsonBytes));
          } catch {
            digests = null;
          }
        }
      }
      // A truncated stream is judged by the exit: a clean exit without its end frame is no echo.
      return decoder.ended ? digests : null;
    };
    const drain = async (): Promise<void> => {
      let bytes = 0;
      for await (const chunk of child.stderr) {
        bytes += chunk.byteLength;
        if (bytes > bounds.stderrBytes) refuse("Verifier stderr exceeded its bound");
        progress();
      }
    };
    const guard = <T>(task: Promise<T>): Promise<T | null> =>
      task.catch((error: unknown) => {
        fail(error);
        return null;
      });

    try {
      const [, digests] = await Promise.all([guard(write()), guard(read()), guard(drain())]);
      const exit = await child.exited;
      if (state.failure !== null) throw state.failure;
      return { exit, digests };
    } finally {
      state.running = false;
      cancelIdle();
      cancelWall();
      cancelSample();
    }
  }
}
