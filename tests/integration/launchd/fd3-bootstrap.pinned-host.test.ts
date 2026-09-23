import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  CanonicalAbsolutePathV1,
  EffectiveUidV1,
  LaunchdEffectIdV1,
  LowerHexSha256,
  UInt64DecimalV1,
  UtcTimestampV1,
} from "@developer-os/core";
import {
  LaunchdDistributionUnsupportedError,
  LaunchdObserver,
  LaunchdSnapshotBootstrapper,
  SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  admitLaunchdDistribution,
  encodeLaunchdPlist,
  expandLaunchdProcessTable,
  generatedLabel,
  launchdGuiDomain,
  parseScheduledProductHome,
  scheduledProgramArguments,
  type LaunchdPlistDictionaryV1,
  type LaunchdProcessDirectoryIdentityV1,
  type ObservedLaunchdDistributionV1,
  type SupportedLaunchdProcessTableTemplateV1,
} from "@developer-os/platform-macos";
import { SupervisedProcessRunner, nodeSupervisedProcessDependencies } from "@developer-os/security";
import { describe, expect, it } from "vitest";

/**
 * Spec §5.3's certification fixture (plan 1b Task 19). It loads and unloads one synthetic
 * generated label in the real `gui/<uid>` domain, so it runs only on a disposable host at the
 * pinned build, with `DEVELOPER_OS_LAUNCHD_CERTIFICATION_HOST=disposable`. Everywhere else it
 * throws `unsupported_launchd_distribution`: a skip would read as a pass.
 */
const DISPOSABLE_HOST = process.env.DEVELOPER_OS_LAUNCHD_CERTIFICATION_HOST === "disposable";

function effectiveUid(): number {
  if (process.getuid === undefined) throw new LaunchdDistributionUnsupportedError("effective uid is unavailable");
  return process.getuid();
}

function swVers(flag: "-productName" | "-productVersion" | "-buildVersion"): string {
  return execFileSync("/usr/bin/sw_vers", [flag], { encoding: "utf8", env: {} }).trim();
}

async function operatingSystem(): Promise<ObservedLaunchdDistributionV1["operatingSystem"]> {
  return Promise.resolve({ productName: swVers("-productName"), productVersion: swVers("-productVersion"), buildVersion: swVers("-buildVersion") });
}

async function inspectExecutable(path: "/bin/launchctl"): Promise<ObservedLaunchdDistributionV1["executable"]> {
  const stats = await lstat(path, { bigint: true });
  const kind = stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other";
  const sha256 = kind === "file" ? createHash("sha256").update(await readFile(path)).digest("hex") : "";
  return { path, kind, ownerUid: Number(stats.uid), mode: Number(stats.mode & 0o7777n), size: Number(stats.size), sha256 };
}

async function directoryIdentity(path: string, ownerUid: EffectiveUidV1): Promise<LaunchdProcessDirectoryIdentityV1> {
  const stats = await lstat(path, { bigint: true });
  return {
    path: path as CanonicalAbsolutePathV1,
    ownerUid,
    mode: 448,
    dev: stats.dev.toString(10) as UInt64DecimalV1,
    ino: stats.ino.toString(10) as UInt64DecimalV1,
  };
}

describe("launchctl FD-3 bootstrap certification", () => {
  it("loads the generated label from an already-unlinked inherited snapshot and leaves nothing behind", async () => {
    if (!DISPOSABLE_HOST) {
      throw new LaunchdDistributionUnsupportedError("certification runs only on a disposable host (DEVELOPER_OS_LAUNCHD_CERTIFICATION_HOST=disposable)");
    }
    const observedOs = await operatingSystem();
    const observedExecutable = await inspectExecutable("/bin/launchctl");
    admitLaunchdDistribution({ operatingSystem: observedOs, executable: observedExecutable });

    const uid = effectiveUid() as EffectiveUidV1;
    const domain = launchdGuiDomain(uid);
    const base = await realpath(await mkdtemp(join(tmpdir(), "dos-launchd-certification-")));
    const runner = new SupervisedProcessRunner(nodeSupervisedProcessDependencies);
    const generation = createHash("sha256").update(randomBytes(32)).digest("hex") as LowerHexSha256;
    const label = generatedLabel("doctor", generation);
    let loaded = false;
    try {
      const productHome = join(base, "product-home");
      const root = join(productHome, "staging", "lifecycle", `lc_${"0".repeat(64)}_1`, "launchd-process");
      await mkdir(join(root, "home"), { recursive: true });
      await mkdir(join(root, "tmp"));
      for (const path of [root, join(root, "home"), join(root, "tmp")]) await chmod(path, 0o700);
      // The row under certification: the transcript hash this run prints is what Task 19 records.
      const candidate: SupportedLaunchdProcessTableTemplateV1 = {
        ...SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
        certification: { certifiedAt: new Date().toISOString() as UtcTimestampV1, fixtureTranscriptSha256: "0".repeat(64) as LowerHexSha256 },
      };
      const table = expandLaunchdProcessTable(
        {
          root: await directoryIdentity(root, uid),
          home: await directoryIdentity(join(root, "home"), uid),
          tmp: await directoryIdentity(join(root, "tmp"), uid),
        },
        candidate,
      );

      const plist: LaunchdPlistDictionaryV1 = {
        Label: label,
        ProgramArguments: scheduledProgramArguments("doctor", parseScheduledProductHome(productHome), generation, "/usr/bin/true" as CanonicalAbsolutePathV1),
        StartCalendarInterval: { Weekday: 0, Hour: 3, Minute: 17 },
        StandardOutPath: "/dev/null",
        StandardErrorPath: "/dev/null",
      };
      const bytes = new TextEncoder().encode(encodeLaunchdPlist(plist));
      const plistPath = join(base, "com.developer-os.doctor.plist");
      await writeFile(plistPath, bytes, { mode: 0o600 });
      await chmod(plistPath, 0o600);
      const plistStats = await lstat(plistPath, { bigint: true });

      const bootstrapper = new LaunchdSnapshotBootstrapper({
        runner,
        template: candidate,
        effectiveUid,
        operatingSystem,
        inspectExecutable,
        fs: {
          lstat: (path, options) => lstat(path, options),
          open: (path, flags, mode) => open(path, flags, mode),
          readdir: (path) => readdir(path),
          unlink: (path) => unlink(path),
        },
      });
      const observer = new LaunchdObserver({
        runner,
        effectiveUid,
        consoleUserUid: async () => Number((await lstat("/dev/console", { bigint: true })).uid),
        operatingSystem,
        inspectExecutable,
        inspectEmptyDirectory: async (path) => {
          const stats = await lstat(path, { bigint: true });
          return {
            kind: stats.isDirectory() ? "directory" : "other",
            ownerUid: Number(stats.uid),
            mode: Number(stats.mode & 0o7777n),
            dev: stats.dev.toString(10),
            ino: stats.ino.toString(10),
            entryCount: (await readdir(path)).length,
          };
        },
      });

      const baseline = readdirSync("/dev/fd").length;
      const phase = runner.beginPhase("launchd-certification", table.transitionDeadlineMs);
      const attempt = await bootstrapper.prepare({
        table,
        domain,
        effectId: `le_${"0".repeat(64)}_2` as LaunchdEffectIdV1,
        planHash: "0".repeat(64) as LowerHexSha256,
        direction: "forward",
        transitionIndex: 0,
        role: "after",
        source: {
          path: plistPath as CanonicalAbsolutePathV1,
          ownerUid: uid,
          mode: 384,
          nlink: 1,
          size: bytes.byteLength,
          hash: createHash("sha256").update(bytes).digest("hex") as LowerHexSha256,
          dev: plistStats.dev.toString(10) as UInt64DecimalV1,
          ino: plistStats.ino.toString(10) as UInt64DecimalV1,
        },
        plist,
        phase,
      });
      expect(attempt.snapshot.nlink).toBe(0);
      expect(await readdir(join(root, "tmp"))).toEqual([]);

      const evidence = await bootstrapper.bootstrap(attempt);
      loaded = true;
      expect(evidence.process.termination).toBe("exited");
      expect(evidence.process.exitCode).toBe(0);
      const afterBootstrap = await observer.observe({ domain, jobs: [{ job: "doctor", retained: null, planned: label }] });
      expect(afterBootstrap).toEqual({ kind: "observed", jobs: [{ job: "doctor", state: { kind: "exact_new", label, generation } }] });
      expect(await readdir(join(root, "home"))).toEqual([]);
      expect(await readdir(join(root, "tmp"))).toEqual([]);
      expect(readdirSync("/dev/fd").length).toBe(baseline);

      const transcript = JSON.stringify({
        operatingSystem: observedOs,
        launchctl: { size: observedExecutable.size, sha256: observedExecutable.sha256 },
        attempt,
        process: evidence.process,
        observedAfter: afterBootstrap,
      });
      process.stdout.write(`launchctl FD-3 certification transcript sha256: ${createHash("sha256").update(transcript).digest("hex")}\n`);
    } finally {
      if (loaded) {
        await runner.run({
          executable: "/bin/launchctl",
          argv: ["bootout", `${domain}/${label}`],
          env: { HOME: "/private/var/empty", LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TMPDIR: "/private/var/empty" },
          cwd: "/private/var/empty",
          stdin: "ignore",
          inheritedFds: [],
          stdoutCap: 1048576,
          stderrCap: 1048576,
          idleMs: 30000,
          wallMs: 30000,
          terminationGraceMs: 100,
          phase: runner.beginPhase("launchd-certification-bootout", 30000),
        });
      }
      await rm(base, { recursive: true, force: true });
    }
  }, 120_000);
});
