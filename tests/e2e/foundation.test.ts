import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type {
  CliError,
  CliResult,
  InstallationManifestV1,
  TransactionJournalV1,
} from "@developer-os/core";
import type { DoctorReportV1 } from "@developer-os/cli/dist/commands/doctor.js";
import type { InitResultV1 } from "@developer-os/cli/dist/commands/init.js";
import type { RepairResultV1 } from "@developer-os/cli/dist/commands/repair.js";
import type { StatusReportV1 } from "@developer-os/cli/dist/commands/status.js";
import type { UninstallResultV1 } from "@developer-os/cli/dist/commands/uninstall.js";

import { runCli, runJson } from "../helpers/run-cli.js";
import {
  addedPaths,
  changedPaths,
  createTempHome,
  filesContaining,
  installFakeExecutable,
  inventory,
  isInside,
  removedPaths,
  removeTempHome,
} from "../helpers/temp-home.js";
import type { Inventory, TempHome } from "../helpers/temp-home.js";

/**
 * A marker with no meaning to the product, planted where a leak would land. It
 * is written into a Brain note, a malformed configuration file, and the child's
 * environment; nothing the product prints or persists may contain it.
 */
const SENTINEL = "DEVELOPER_OS_SECRET_SENTINEL_7f4c";

/**
 * Narrows a result and fails with the product's own error text rather than
 * `expected true to be false`, which says nothing about which command refused.
 */
function okData<T>(result: CliResult<T>): T {
  if (!result.ok) {
    throw new Error(
      `expected success, got exit ${String(result.code)}: ${result.error.message}`,
    );
  }
  return result.data;
}

function errorOf(result: CliResult<unknown>): CliError {
  if (result.ok) {
    throw new Error("expected a failure, got a successful result");
  }
  return result.error;
}

/** Every check `doctor` can report, in the order `collectFindings` produces them. */
const DOCTOR_CHECKS = [
  "platform",
  "product-home",
  "configuration",
  "manifest",
  "transactions",
  "drift",
  "brain",
  "agents",
  "claude-capabilities",
] as const;

/**
 * A failing `doctor` publishes no checks: `runDoctor` returns the report only on
 * success, and on failure collapses the failing checks into one `id: message`
 * list joined by `"; "`.
 *
 * Recovering the ids by splitting on `"; "` and cutting at the first `":"` is
 * not safe — several check messages are a redacted filesystem error, which can
 * contain both separators, and a mangled id would silently satisfy a
 * `not.toContain` assertion. Matching each *known* id against an anchored
 * pattern instead means stray punctuation inside a message can neither invent a
 * check nor hide one.
 */
function failedChecks(error: CliError): readonly string[] {
  return DOCTOR_CHECKS.filter((id) =>
    new RegExp(`(?:^|; )${id}:`, "u").test(error.message),
  );
}

/**
 * One sandbox per case, removed whatever the case does. Refusal cases leave the
 * machine in deliberately awkward states — read-only directories, dangling
 * symlinks, half-written journals — and none of them may leak into the next.
 */
async function withHome(
  body: (home: TempHome) => Promise<void>,
): Promise<void> {
  const home = await createTempHome();
  try {
    await body(home);
  } finally {
    await removeTempHome(home);
  }
}

/**
 * The three directories the product churns for its own bookkeeping. A path that
 * appears under one of them is transaction state, not an installed artifact.
 */
function internalRootsOf(home: TempHome): readonly string[] {
  return ["state", "staging", "backups"].map((name) =>
    join(home.productHome, name),
  );
}

/** Installs a healthy machine and returns the inventory it produced. */
async function install(home: TempHome): Promise<Inventory> {
  const run = await runJson<InitResultV1>(home, ["init", "--yes", "--json"]);
  okData(run.result);
  return inventory(home.root);
}

describe("Foundation temporary-HOME lifecycle", () => {
  it("installs, reports, repeats, and removes itself without touching anything else", async () => {
    await withHome(async (home) => {
      await installFakeExecutable(home, "claude");

      const configFile = join(home.productHome, "config.toml");
      const manifestFile = join(home.productHome, "installation-manifest.json");
      const stateDir = join(home.productHome, "state");
      const stagingDir = join(home.productHome, "staging");
      const backupsDir = join(home.productHome, "backups");
      const logsDir = join(home.productHome, "logs");
      const brainKeep = join(home.brain, ".gitkeep");

      const internalRoots = internalRootsOf(home);

      function assertDeclared(
        before: Inventory,
        after: Inventory,
        declared: readonly string[],
      ): void {
        for (const path of declared) {
          expect(before.has(path), `${path} existed before the command`).toBe(
            false,
          );
          expect(after.has(path), `${path} was declared but not created`).toBe(
            true,
          );
        }

        const undeclared = addedPaths(before, after).filter(
          (path) => !declared.includes(path) && path !== manifestFile,
        );
        for (const path of undeclared) {
          expect(
            internalRoots.some((root) => isInside(root, path)),
            `${path} was created without being declared`,
          ).toBe(true);
        }
      }

      // --- init --dry-run: says everything, changes nothing -------------------

      const beforeDryRun = await inventory(home.root);
      const dryRun = await runJson<InitResultV1>(home, [
        "init",
        "--dry-run",
        "--json",
      ]);

      expect(dryRun.exitCode).toBe(EXIT_CODES.success);
      const planned = okData(dryRun.result);
      expect(planned.schemaVersion).toBe(1);
      expect(planned.productHome).toBe(home.productHome);
      expect(planned.brainPath).toBe(home.brain);
      expect(planned.transactionId).toBeNull();
      /**
       * The Brain skeleton joins this list as of DOS-P2 Task 10: `init`
       * installs `templates/brain/` when, and only when, it creates the vault.
       * Asserted as a prefix plus a set, because the template's own contents
       * are pinned by `brain-template.test.ts` and restating them here would
       * make every template edit a two-file change with one of them silent.
       */
      expect(planned.created.slice(0, 8)).toStrictEqual([
        home.productHome,
        stateDir,
        stagingDir,
        backupsDir,
        logsDir,
        configFile,
        home.brain,
        brainKeep,
      ]);
      const template = planned.created.slice(8);
      expect(template.length).toBeGreaterThan(0);
      /** The content root itself is the first entry, then everything under it. */
      expect(template[0]).toBe(`${home.brain}/content`);
      for (const path of template) {
        expect(path.startsWith(`${home.brain}/content`)).toBe(true);
      }
      expect(planned.unchanged).toStrictEqual([]);

      const afterDryRun = await inventory(home.root);
      expect(
        afterDryRun,
        "a dry run wrote to the temporary home",
      ).toStrictEqual(beforeDryRun);

      // --- init --yes: creates exactly what the dry run promised --------------

      const installed = await runJson<InitResultV1>(home, [
        "init",
        "--yes",
        "--json",
      ]);

      expect(installed.exitCode).toBe(EXIT_CODES.success);
      const created = okData(installed.result);
      expect(created.created).toStrictEqual(planned.created);
      expect(created.transactionId).toMatch(/^tx_[0-9a-f-]{36}$/u);

      const afterInit = await inventory(home.root);
      assertDeclared(afterDryRun, afterInit, created.created);
      expect(afterInit.get(home.brain)).toBe("dir");
      expect(afterInit.get(brainKeep)).toBe(
        "file:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      expect(afterInit.get(manifestFile)).toMatch(/^file:[0-9a-f]{64}$/u);
      expect(removedPaths(afterDryRun, afterInit)).toStrictEqual([]);

      // --- status: healthy installed state, no mutation -----------------------

      const beforeStatus = await inventory(home.root);
      const status = await runJson<StatusReportV1>(home, ["status", "--json"]);

      expect(status.exitCode).toBe(EXIT_CODES.success);
      const report = okData(status.result);
      expect(report).toMatchObject({
        schemaVersion: 1,
        productHome: home.productHome,
        brainPath: home.brain,
        installed: true,
        productVersion: "0.0.0",
        configPresent: true,
        brainPresent: true,
        /**
         * The Brain skeleton is manifest-owned as of DOS-P2 Task 10, so this
         * count now covers the vault's directories and files as well as the
         * product's. Left as an exact number rather than a floor: this suite
         * exists to notice that an install created something nobody declared.
         */
        managedArtifacts: 34,
        driftCount: 0,
        incompleteTransactions: [],
      });
      expect(report.agents).toStrictEqual([
        {
          name: "claude",
          installed: true,
          executablePath: join(home.binDir, "claude"),
          version: null,
        },
        { name: "codex", installed: false, executablePath: null, version: null },
      ]);
      expect(await inventory(home.root)).toStrictEqual(beforeStatus);

      // --- doctor: every check passes, still no mutation ----------------------

      const doctor = await runJson<DoctorReportV1>(home, ["doctor", "--json"]);

      expect(doctor.exitCode).toBe(EXIT_CODES.success);
      const checks = okData(doctor.result);
      expect(checks.schemaVersion).toBe(1);
      expect(checks.checks.map((check) => check.id)).toStrictEqual([
        "platform",
        "product-home",
        "configuration",
        "manifest",
        "transactions",
        "drift",
        "brain",
        "agents",
        "claude-capabilities",
      ]);
      expect(
        checks.checks.filter((check) => check.status !== "pass"),
      ).toStrictEqual([]);
      expect(await inventory(home.root)).toStrictEqual(beforeStatus);

      // --- init again: idempotent, declares nothing, changes nothing ----------

      const repeated = await runJson<InitResultV1>(home, [
        "init",
        "--yes",
        "--json",
      ]);

      expect(repeated.exitCode).toBe(EXIT_CODES.success);
      const unchanged = okData(repeated.result);
      expect(unchanged.created).toStrictEqual([]);
      expect(unchanged.transactionId).toBeNull();
      expect(unchanged.unchanged).toStrictEqual([
        home.productHome,
        stateDir,
        stagingDir,
        backupsDir,
        logsDir,
        configFile,
        home.brain,
      ]);
      expect(await inventory(home.root)).toStrictEqual(beforeStatus);

      // --- uninstall: removes what it owns, keeps the Brain -------------------

      const beforeUninstall = await inventory(home.root);
      const uninstalled = await runJson<UninstallResultV1>(home, [
        "uninstall",
        "--yes",
        "--json",
      ]);

      expect(uninstalled.exitCode).toBe(EXIT_CODES.success);
      const removal = okData(uninstalled.result);
      expect(removal.removed).toStrictEqual([configFile, logsDir]);
      expect(removal.restored).toStrictEqual([]);
      /**
       * `state`, `staging`, and `backups` hold the journal and backups of the very
       * transaction that performed the removal, so `rmdir` refuses them and they
       * survive with no manifest entry. Foundation Task 8 recorded this as residual
       * 4; it is pinned here so that closing it is a deliberate change rather than
       * a surprise.
       */
      const preserved = [...removal.preserved].sort();
      for (const path of [
        home.brain,
        brainKeep,
        home.productHome,
        stateDir,
        stagingDir,
        backupsDir,
      ]) {
        expect(preserved, path).toContain(path);
      }

      /**
       * **Every vault artifact survives**, which is the property this whole
       * paragraph exists for. The Brain skeleton is manifest-owned as of
       * DOS-P2 Task 10, so it is `uninstall`'s *location* rule that keeps it —
       * not the absence of a manifest entry. Asserted as "everything under the
       * vault, and nothing under it removed", rather than by listing the
       * template, which `brain-template.test.ts` already pins.
       */
      const removedFromVault = removal.removed.filter((path) =>
        path.startsWith(home.brain),
      );
      expect(removedFromVault).toStrictEqual([]);
      expect(
        preserved.filter((path) => path.startsWith(`${home.brain}/content`))
          .length,
      ).toBeGreaterThan(0);

      const afterUninstall = await inventory(home.root);
      expect(afterUninstall.has(configFile)).toBe(false);
      expect(afterUninstall.has(manifestFile)).toBe(false);
      expect(afterUninstall.has(logsDir)).toBe(false);
      expect(afterUninstall.get(home.brain)).toBe("dir");
      expect(afterUninstall.get(brainKeep)).toBe(
        "file:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );

      /**
       * Nothing outside the product home may move. The Brain is listed explicitly
       * because it is the one user-owned tree the product knows the path of.
       */
      for (const path of [
        ...removedPaths(beforeUninstall, afterUninstall),
        ...changedPaths(beforeUninstall, afterUninstall),
        ...addedPaths(beforeUninstall, afterUninstall),
      ]) {
        expect(
          isInside(home.productHome, path),
          `${path} changed outside the product home`,
        ).toBe(true);
      }

      // --- uninstall again: nothing owned remains -----------------------------

      const beforeSecondUninstall = await inventory(home.root);
      const again = await runJson<UninstallResultV1>(home, [
        "uninstall",
        "--yes",
        "--json",
      ]);

      expect(again.exitCode).toBe(EXIT_CODES.success);
      expect(okData(again.result)).toStrictEqual({
        schemaVersion: 1,
        removed: [],
        restored: [],
        preserved: [],
        transactionId: null,
      });
      expect(await inventory(home.root)).toStrictEqual(beforeSecondUninstall);

      // --- doctor on the emptied machine: reports, never repairs --------------

      const afterAllCommands = await runJson<DoctorReportV1>(home, [
        "doctor",
        "--json",
      ]);

      expect(afterAllCommands.exitCode).toBe(EXIT_CODES.operationalFailure);
      const failure: CliError = errorOf(afterAllCommands.result);
      expect(failure.kind).toBe("doctor_failed");
      expect(failure.recovery).toBe("developer-os init");
      expect(await inventory(home.root)).toStrictEqual(beforeSecondUninstall);
    });
  });
});

describe("Foundation refusals", () => {
  it("refuses a Brain nested inside the product home", async () => {
    await withHome(async (home) => {
      const before = await inventory(home.root);

      /**
       * `--yes`, not `--dry-run`. A dry run changes nothing by definition, so
       * the no-mutation assertion below would be satisfied by the flag rather
       * than by the refusal. The refusal happens in `buildPlan`, before any
       * directory is created, so the real run refuses identically and the
       * assertion becomes load-bearing.
       */
      const run = await runJson<InitResultV1>(home, ["init", "--yes", "--json"], {
        env: { DEVELOPER_OS_BRAIN: join(home.productHome, "vault") },
      });

      expect(run.exitCode).toBe(EXIT_CODES.securityRefusal);
      expect(errorOf(run.result).message).toMatch(/disjoint/iu);
      expect(await inventory(home.root)).toStrictEqual(before);
    });
  });

  it("refuses a product home that is a symlink out of the user's home", async () => {
    await withHome(async (home) => {
      const outside = join(home.root, "outside");
      const kept = join(outside, "keep.txt");
      await mkdir(outside, { recursive: true, mode: 0o700 });
      await writeFile(kept, "user data\n");
      await symlink(outside, join(home.home, ".developer-os"));

      const before = await inventory(home.root);
      const run = await runJson<InitResultV1>(home, ["init", "--yes", "--json"], {
        // Unset so the product resolves its own default path. A root named
        // through the environment anchors to itself, so it could not refuse one.
        env: { DEVELOPER_OS_HOME: undefined, DEVELOPER_OS_BRAIN: undefined },
      });

      expect(run.exitCode).toBe(EXIT_CODES.invalidInput);
      expect(errorOf(run.result).message).toMatch(/not a directory/iu);
      expect(await readFile(kept, "utf8")).toBe("user data\n");
      expect(await inventory(home.root)).toStrictEqual(before);
    });
  });

  it("refuses a read-only target without leaving anything behind", async () => {
    await withHome(async (home) => {
      await chmod(home.home, 0o500);
      // Captured after the chmod, so the comparison does not silently depend on
      // `inventory` ignoring modes.
      const before = await inventory(home.root);

      try {
        const run = await runJson<InitResultV1>(home, [
          "init",
          "--yes",
          "--json",
        ]);

        expect(run.exitCode).toBe(EXIT_CODES.operationalFailure);
        expect(errorOf(run.result).kind).toBe("operational_failure");
        expect(await inventory(home.root)).toStrictEqual(before);
      } finally {
        await chmod(home.home, 0o700);
      }
    });
  });

  it("declines when nobody is there to confirm", async () => {
    await withHome(async (home) => {
      const before = await inventory(home.root);

      const run = await runJson<InitResultV1>(home, ["init", "--json"]);

      expect(run.exitCode).toBe(EXIT_CODES.decisionRequired);
      expect(errorOf(run.result).kind).toBe("declined");
      expect(await inventory(home.root)).toStrictEqual(before);
    });
  });

  it("refuses unknown commands and options a command does not accept", async () => {
    await withHome(async (home) => {
      const before = await inventory(home.root);

      for (const args of [
        ["frobnicate"],
        ["status", "--yes"],
        ["init", "--resume", "tx_fixture_001"],
        ["uninstall", "--rollback", "tx_fixture_001"],
        ["--verbose", "init"],
      ]) {
        const run = await runCli(home, args);
        expect(run.exitCode, `${args.join(" ")} was accepted`).toBe(
          EXIT_CODES.invalidInput,
        );
        expect(run.stdout).toBe("");
      }

      expect(await inventory(home.root)).toStrictEqual(before);
    });
  });

  it("refuses every mutation once a managed artifact has drifted", async () => {
    await withHome(async (home) => {
      await install(home);
      const configFile = join(home.productHome, "config.toml");
      const edited = `${await readFile(configFile, "utf8")}\n# edited by the user\n`;
      await writeFile(configFile, edited);
      const drifted = await inventory(home.root);

      const doctor = await runJson<DoctorReportV1>(home, ["doctor", "--json"]);
      expect(doctor.exitCode).toBe(EXIT_CODES.decisionRequired);
      const doctorError = errorOf(doctor.result);
      expect(failedChecks(doctorError)).toStrictEqual(["drift"]);
      expect(doctorError.paths).toContain(configFile);
      expect(doctorError.recovery).toMatch(/uninstall/u);

      const reinit = await runJson<InitResultV1>(home, [
        "init",
        "--yes",
        "--json",
      ]);
      expect(reinit.exitCode).toBe(EXIT_CODES.decisionRequired);

      const uninstall = await runJson<UninstallResultV1>(home, [
        "uninstall",
        "--yes",
        "--json",
      ]);
      expect(uninstall.exitCode).toBe(EXIT_CODES.decisionRequired);
      expect(errorOf(uninstall.result).paths).toContain(configFile);

      /** The user's edit survives all three refusals, byte for byte. */
      expect(await readFile(configFile, "utf8")).toBe(edited);
      expect(await inventory(home.root)).toStrictEqual(drifted);
    });
  });

  it("never removes a manifest artifact that lies outside the product home", async () => {
    await withHome(async (home) => {
      await install(home);

      const outside = join(home.root, "outside");
      const forged = join(outside, "precious.txt");
      await mkdir(outside, { recursive: true, mode: 0o700 });
      await writeFile(forged, "not the product's to delete\n");

      const manifestFile = join(home.productHome, "installation-manifest.json");
      const manifest = JSON.parse(
        await readFile(manifestFile, "utf8"),
      ) as InstallationManifestV1;
      const template = manifest.artifacts.find(
        (artifact) => artifact.kind === "file",
      );
      if (template === undefined) throw new Error("no file artifact to forge from");

      await writeFile(
        manifestFile,
        `${JSON.stringify({
          ...manifest,
          artifacts: [...manifest.artifacts, { ...template, path: forged }],
        })}\n`,
      );

      const run = await runJson<UninstallResultV1>(home, [
        "uninstall",
        "--yes",
        "--json",
      ]);

      expect(run.exitCode).toBe(EXIT_CODES.success);
      const outcome = okData(run.result);
      expect(outcome.removed).not.toContain(forged);
      expect(outcome.preserved).toContain(forged);
      expect(await readFile(forged, "utf8")).toBe(
        "not the product's to delete\n",
      );
    });
  });

  it("leaves its own transaction residue behind after uninstall", async () => {
    await withHome(async (home) => {
      await install(home);
      const configFile = join(home.productHome, "config.toml");
      const configBefore = await readFile(configFile, "utf8");

      const run = await runJson<UninstallResultV1>(home, [
        "uninstall",
        "--yes",
        "--json",
      ]);
      expect(run.exitCode).toBe(EXIT_CODES.success);

      /**
       * Foundation Task 8's residual 4, pinned as what it actually is. The
       * product home and its three bookkeeping directories survive because
       * `rmdir` refuses a directory still holding the journal and backups of the
       * transaction doing the removing — and one of those backups is a byte copy
       * of the `config.toml` just deleted, still readable, still naming the
       * user's Brain. No user data is lost and nothing is misreported, but the
       * residue is not the "three empty directories" it is easy to assume.
       */
      const after = await inventory(home.root);
      expect(after.get(home.productHome)).toBe("dir");
      for (const root of internalRootsOf(home)) {
        expect(after.get(root), `${root} was removed`).toBe("dir");
      }

      const backupCopies = await filesContaining(
        join(home.productHome, "backups"),
        configBefore.trimEnd(),
      );
      expect(
        backupCopies.length,
        "uninstall kept no readable copy of the configuration it removed",
      ).toBeGreaterThan(0);

      /** Whatever survives is the product's own, never the user's. */
      expect(after.get(home.brain)).toBe("dir");
      expect(after.has(join(home.productHome, "logs"))).toBe(false);
    });
  });

  it("still installs when the discovered agent path trips the redactor", async () => {
    await withHome(async (home) => {
      /**
       * A directory long and mixed enough that the redactor rewrites any
       * executable path beneath it. `MacOsPlatformAdapter` then refuses to
       * report a path it can no longer vouch for — correctly, because a
       * rewritten path names an executable that never existed.
       *
       * What must not follow is an unusable product. Foundation installs no
       * agent integration, so this is a warning and the install completes. It
       * did not always: `doctor` graded the refusal as a failing check, `init`
       * read that as failed post-install verification, and every user whose
       * agent lived at such a path — a temporary directory, a content-addressed
       * store — was told only "post-install verification failed".
       */
      const deepBin = join(
        home.root,
        "Xk7QpZm2Rv9TbNw4Ls6YgHc3JdFe8UaVxPn5MqWz",
        "bin",
      );
      await mkdir(deepBin, { recursive: true, mode: 0o700 });
      await writeFile(join(deepBin, "claude"), "#!/bin/sh\nexit 97\n", {
        mode: 0o755,
      });

      const run = await runJson<InitResultV1>(home, ["init", "--yes", "--json"], {
        env: { PATH: deepBin },
      });
      expect(run.exitCode).toBe(EXIT_CODES.success);
      expect(okData(run.result).transactionId).not.toBeNull();

      const after = await inventory(home.root);
      expect(after.has(join(home.productHome, "config.toml"))).toBe(true);
      expect(after.has(join(home.productHome, "installation-manifest.json"))).toBe(
        true,
      );

      const doctor = await runJson<DoctorReportV1>(home, ["doctor", "--json"], {
        env: { PATH: deepBin },
      });
      expect(doctor.exitCode).toBe(EXIT_CODES.success);
      const checks = okData(doctor.result).checks;
      expect(checks.find((check) => check.id === "agents")?.status).toBe("warn");
      expect(checks.filter((check) => check.status === "fail")).toStrictEqual([]);

      /** `status` reported it as a warning all along; the two now agree. */
      const status = await runJson<StatusReportV1>(home, ["status", "--json"], {
        env: { PATH: deepBin },
      });
      expect(status.exitCode).toBe(EXIT_CODES.success);
      expect(okData(status.result).agents).toStrictEqual([]);
      expect(
        status.result.ok ? status.result.warnings : [],
      ).not.toStrictEqual([]);
    });
  });
});

/**
 * Every phase *boundary* a crash can leave behind — not every state. `finalized`
 * and `rolled_back` are terminal and so are not interruptions.
 *
 * A real crash can also land mid-phase: half the mutations applied, a
 * `.<name>.<txid>-<n>.tmp` left beside a target by `writeDurableFile`, or a
 * backup blob written without its metadata pair. None of that is reachable
 * through `interruptAt`, so `removeOwnedTemp`, the rename-failure path, and
 * `TransactionConflictError` have no end-to-end coverage here. They are covered
 * by the unit suite in `packages/core/src/transactions/transactions.test.ts`.
 */
const INTERRUPTION_PHASES = [
  "planned",
  "backed_up",
  "staged",
  "validated",
  "applied",
  "verified",
] as const;

/** `backUp` is what transitions *out of* `planned`, so at `planned` there are none. */
const BEFORE_BACKUP = new Set<string>(["planned"]);

/** `apply` is what transitions out of `validated`, so up to and including it the targets are absent. */
const BEFORE_APPLY = new Set<string>([
  "planned",
  "backed_up",
  "staged",
  "validated",
]);

/**
 * Reproduces the on-disk state a crash at `phase` leaves behind.
 *
 * The fixture is a real transaction, not a forged one: the install runs to
 * completion so that every journal, staged blob, backup and digest is written by
 * the product itself, and only then is the recorded phase rewound and the side
 * effects of the later phases undone. Hand-writing the journal would prove the
 * test author understood the format, which is not the thing under test.
 */
async function interruptAt(
  home: TempHome,
  phase: (typeof INTERRUPTION_PHASES)[number],
): Promise<{ readonly id: string; readonly targets: readonly string[] }> {
  const journalDir = join(home.productHome, "state", "transactions");
  const names = (await readdir(journalDir)).filter(
    (name) => name.endsWith(".json") && !name.startsWith("."),
  );
  const [name] = names;
  if (names.length !== 1 || name === undefined) {
    throw new Error(`expected exactly one journal, found ${String(names.length)}`);
  }

  const id = name.slice(0, -".json".length);
  const journalPath = join(journalDir, name);
  const journal = JSON.parse(
    await readFile(journalPath, "utf8"),
  ) as TransactionJournalV1;

  /**
   * `updatedAt` is rewound with the phase. Leaving the finalize-time stamp on a
   * journal that claims `planned` produces a record no real run can write, and
   * if a staleness heuristic is ever added to `checkTransactions` all eighteen
   * of these cases would quietly change meaning.
   */
  await writeFile(
    journalPath,
    `${JSON.stringify({ ...journal, phase, updatedAt: journal.createdAt })}\n`,
    { mode: 0o600 },
  );

  /**
   * Every path below comes out of a journal parsed off disk, and one of these is
   * a recursive delete. The journal is written by the product into the sandbox,
   * so they are inside it today — this asserts that rather than trusting it.
   */
  const remove = async (
    path: string,
    options: { readonly recursive?: boolean } = {},
  ): Promise<void> => {
    if (!isInside(home.root, path)) {
      throw new Error(`refusing to remove ${path}: outside the sandbox`);
    }
    await rm(path, { force: true, recursive: options.recursive ?? false });
  };

  /**
   * The manifest is written after `execute` returns, so no crash *inside* the
   * transaction can have produced one.
   */
  await remove(join(home.productHome, "installation-manifest.json"));

  if (BEFORE_APPLY.has(phase)) {
    for (const mutation of journal.mutations) await remove(mutation.targetPath);
  }
  if (BEFORE_BACKUP.has(phase)) {
    await remove(join(home.productHome, "backups", "transactions", id), {
      recursive: true,
    });
  }

  return { id, targets: journal.mutations.map((mutation) => mutation.targetPath) };
}

describe.each(INTERRUPTION_PHASES)(
  "an install interrupted at phase %s",
  (phase) => {
    it("is reported, blocks init, and names both ways out", async () => {
      await withHome(async (home) => {
        await install(home);
        const { id } = await interruptAt(home, phase);

        const doctor = await runJson<DoctorReportV1>(home, ["doctor", "--json"]);
        expect(doctor.exitCode).toBe(EXIT_CODES.recoveryRequired);
        const doctorError = errorOf(doctor.result);
        expect(failedChecks(doctorError)).toContain("transactions");
        expect(doctorError.recovery).toBe(
          `developer-os repair --resume ${id} | developer-os repair --rollback ${id}`,
        );

        /**
         * Machine health is a precondition of `init`, not a postcondition: a
         * stale journal must stop the install before it mutates anything.
         */
        const blocked = await runJson<InitResultV1>(home, [
          "init",
          "--yes",
          "--json",
        ]);
        expect(blocked.exitCode).toBe(EXIT_CODES.recoveryRequired);
        expect(errorOf(blocked.result).recovery).toBe(doctorError.recovery);
      });
    });

    it("resumes to a complete install", async () => {
      await withHome(async (home) => {
        const installed = await install(home);
        const { id, targets } = await interruptAt(home, phase);

        const repaired = await runJson<RepairResultV1>(home, [
          "repair",
          "--resume",
          id,
          "--json",
        ]);

        expect(repaired.exitCode).toBe(EXIT_CODES.success);
        expect(okData(repaired.result)).toStrictEqual({
          schemaVersion: 1,
          id,
          action: "resumed",
          phase: "finalized",
        });

        /**
         * Content, not just presence. For `applied` and `verified` the targets
         * were never removed by the fixture, so asserting they exist afterwards
         * proves nothing — and a resume that wrote the wrong bytes would pass
         * either way. Comparing against the hashes the original install produced
         * is what makes this an assertion about `repair`.
         */
        const after = await inventory(home.root);
        for (const target of targets) {
          expect(after.get(target), `${target} was not restored`).toBe(
            installed.get(target),
          );
        }

        const doctor = await runJson<DoctorReportV1>(home, ["doctor", "--json"]);
        expect(failedChecks(errorOf(doctor.result))).not.toContain(
          "transactions",
        );

        /**
         * Foundation Task 8's residual 1, pinned rather than described: the
         * files are all back, but the manifest was never written, and `init`
         * answers "already initialized" while `doctor` still says the
         * installation is incomplete. Nothing in the CLI resolves that. If a
         * later change makes `init` re-adopt on-disk artifacts, this assertion
         * is the one that should fail and be deleted.
         */
        const reinit = await runJson<InitResultV1>(home, [
          "init",
          "--yes",
          "--json",
        ]);
        expect(reinit.exitCode).toBe(EXIT_CODES.success);
        expect(okData(reinit.result).created).toStrictEqual([]);

        // Re-run, so this reports the state *after* the re-init rather than
        // re-reading the report taken before it.
        const settled = await runJson<DoctorReportV1>(home, ["doctor", "--json"]);
        expect(failedChecks(errorOf(settled.result))).toContain("manifest");
      });
    });

    it("rolls back to the state before the install", async () => {
      await withHome(async (home) => {
        const beforeInstall = await inventory(home.root);
        await install(home);
        const { id, targets } = await interruptAt(home, phase);

        const rolled = await runJson<RepairResultV1>(home, [
          "repair",
          "--rollback",
          id,
          "--json",
        ]);

        expect(rolled.exitCode).toBe(EXIT_CODES.success);
        expect(okData(rolled.result)).toStrictEqual({
          schemaVersion: 1,
          id,
          action: "rolled_back",
          phase: "rolled_back",
        });

        const after = await inventory(home.root);
        for (const target of targets) {
          expect(after.has(target), `${target} survived the rollback`).toBe(
            false,
          );
        }

        /**
         * What makes the case's name true. Outside the product's own
         * bookkeeping — where journals, staged blobs and backups legitimately
         * survive — nothing may be removed, nothing may be changed, and the only
         * additions may be the directory skeleton `init` created. A leftover
         * *file* anywhere else is a rollback that did not finish.
         */
        const internal = internalRootsOf(home);
        expect(removedPaths(beforeInstall, after)).toStrictEqual([]);
        expect(changedPaths(beforeInstall, after)).toStrictEqual([]);
        for (const path of addedPaths(beforeInstall, after)) {
          if (internal.some((root) => isInside(root, path))) continue;
          expect(after.get(path), `${path} outlived the rollback`).toBe("dir");
        }

        const doctor = await runJson<DoctorReportV1>(home, ["doctor", "--json"]);
        expect(failedChecks(errorOf(doctor.result))).not.toContain(
          "transactions",
        );

        /**
         * The assertion that carries the weight. For `planned` through
         * `validated` the targets were already absent, so "absent afterwards"
         * proves almost nothing; what matters at every phase is that the
         * machine is *installable again* — the journal is terminal, no drift
         * blocks the way, and a fresh `init` produces a complete installation.
         */
        const reinstalled = await runJson<InitResultV1>(home, [
          "init",
          "--yes",
          "--json",
        ]);
        expect(reinstalled.exitCode).toBe(EXIT_CODES.success);
        expect(okData(reinstalled.result).created).toContain(
          join(home.productHome, "config.toml"),
        );
        expect(
          okData(
            (await runJson<DoctorReportV1>(home, ["doctor", "--json"])).result,
          ).checks.filter((check) => check.status !== "pass"),
        ).toStrictEqual([]);
      });
    });
  },
);

describe("Foundation boundaries", () => {
  it("ships no network capability", async () => {
    const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
    const patterns = [
      /node:(?:http|https|net|tls|dgram|dns|http2)\b/u,
      /[^\w.]fetch\s*\(/u,
      /XMLHttpRequest/u,
      /WebSocket/u,
    ];

    /**
     * Discovered, not listed. `BACKLOG.md` NEW-1: `packages/brain` was added on
     * 2026-08-07 and never appeared in the hardcoded array, so its compiled
     * modules were scanned by nothing while two approved documents claimed the
     * scan covered "every compiled non-test module". A guarantee a spec asserts
     * and a test does not check is worse than an unasserted one, because the
     * next reviewer stops looking.
     */
    const workspaces: string[] = [];
    for (const group of ["apps", "packages"]) {
      const entries = await readdir(join(repoRoot, group), {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (entry.isDirectory()) workspaces.push(`${group}/${entry.name}`);
      }
    }
    workspaces.sort();

    expect(workspaces.length).toBeGreaterThan(0);
    expect(workspaces).toContain("packages/brain");

    const offenders: string[] = [];
    const perPackage = new Map<string, number>();
    for (const packageDir of workspaces) {
      const dist = join(repoRoot, packageDir, "dist");
      const files = [...(await inventory(dist))].filter(
        ([path, kind]) =>
          kind.startsWith("file:") &&
          path.endsWith(".js") &&
          !path.endsWith(".test.js"),
      );

      /**
       * An unbuilt package yields an empty inventory, and a scan over nothing
       * finds nothing. Without this the whole assertion passes precisely when
       * there is no evidence for it.
       */
      expect(
        files.length,
        `${dist} contains no compiled modules`,
      ).toBeGreaterThan(0);

      perPackage.set(packageDir, files.length);
      for (const [path] of files) {
        const source = await readFile(path, "utf8");
        for (const pattern of patterns) {
          if (pattern.test(source)) {
            offenders.push(`${path} matches ${String(pattern)}`);
          }
        }
      }
    }

    expect(offenders).toStrictEqual([]);

    /**
     * Per package, never a single total: a floor over the sum is satisfied by
     * one populated workspace while every other goes unread, which is the exact
     * shape of the gap this replaced. The counts themselves are deliberately
     * not pinned to an exact number — `docs/architecture/foundation.md` §7 now
     * describes the scan by what it enumerates rather than by how many modules
     * it found, so adding a module is not a two-file change with one of them
     * silent.
     */
    for (const workspace of workspaces) {
      expect(perPackage.get(workspace), workspace).toBeGreaterThan(0);
    }
  });

  /**
   * Before any install, so no manifest exists and therefore no drift check can
   * refuse the command first. That ordering matters: on an installed machine a
   * hand-edited `config.toml` is a *drifted managed artifact*, and `init` and
   * `uninstall` refuse on drift long before anything parses TOML. This case is
   * what actually drives the parser over a file containing the sentinel.
   */
  it("never quotes the configuration it failed to parse", async () => {
    await withHome(async (home) => {
      const configFile = join(home.productHome, "config.toml");
      await mkdir(home.productHome, { recursive: true, mode: 0o700 });
      await writeFile(
        configFile,
        `brainPath = "${home.brain}"\nsecret = ${SENTINEL}\n[[[\n`,
      );

      for (const args of [
        ["status", "--json"],
        ["doctor", "--json"],
        ["status"],
        ["doctor"],
      ]) {
        const run = await runCli(home, args);
        expect(run.timedOut, `${args.join(" ")} timed out`).toBe(false);
        expect(run.stdout + run.stderr).not.toContain(SENTINEL);
        // A positive control: the command must actually have said something,
        // or "the sentinel is absent" is a statement about silence.
        expect((run.stdout + run.stderr).length).toBeGreaterThan(0);
      }

      const parsed = await runJson<StatusReportV1>(home, ["status", "--json"]);
      expect(okData(parsed.result).configPresent).toBe(false);
      expect(parsed.result.ok ? parsed.result.warnings : []).not.toStrictEqual(
        [],
      );

      expect(await filesContaining(home.root, SENTINEL)).toStrictEqual([
        configFile,
      ]);
    });
  });

  it("never echoes or persists a secret it was shown", async () => {
    await withHome(async (home) => {
      await install(home);

      const brainNote = join(home.brain, "notes.md");
      const configFile = join(home.productHome, "config.toml");

      /** In the vault, which the product inspects but must never copy out of. */
      await writeFile(brainNote, `token: ${SENTINEL}\n`);
      /**
       * And in the configuration it parses, deliberately malformed: `smol-toml`
       * embeds three raw source lines in its error, so a propagated parser
       * message would print this file into `status`, `doctor`, and their JSON.
       */
      await writeFile(
        configFile,
        `brainPath = "${home.brain}"\nsecret = ${SENTINEL}\n[[[\n`,
      );

      for (const args of [
        ["status"],
        ["status", "--json"],
        ["doctor"],
        ["doctor", "--json"],
        ["init", "--yes", "--json"],
        ["uninstall", "--yes", "--json"],
        ["repair", "--resume", "tx_fixture_001", "--json"],
      ]) {
        const run = await runCli(home, args, {
          env: { DEVELOPER_OS_TEST_TOKEN: SENTINEL },
        });
        /**
         * A killed child produces empty streams, and two `not.toContain`
         * assertions over nothing pass. Both guards below turn that into a
         * failure.
         */
        expect(run.timedOut, `${args.join(" ")} timed out`).toBe(false);
        expect(
          (run.stdout + run.stderr).length,
          `${args.join(" ")} produced no output at all`,
        ).toBeGreaterThan(0);
        expect(run.stdout, `${args.join(" ")} echoed the sentinel`).not.toContain(
          SENTINEL,
        );
        expect(run.stderr, `${args.join(" ")} echoed the sentinel`).not.toContain(
          SENTINEL,
        );
      }

      /**
       * Exactly the two files the test planted, and nothing the product wrote.
       * Asserting the planted pair rather than an empty set also proves the scan
       * can find the sentinel at all.
       */
      expect(await filesContaining(home.root, SENTINEL)).toStrictEqual(
        [brainNote, configFile].sort(),
      );
    });
  });
});
