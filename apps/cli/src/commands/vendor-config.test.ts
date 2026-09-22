import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type { ClaudeDenyRulesV1 } from "@developer-os/adapter-claude";
import { PROTECTED_PATH_RULES } from "@developer-os/security";

import type { CliContext } from "../context.js";
import { run } from "../main.js";
import { doctorExitCode } from "./doctor.js";
import { runInit } from "./init.js";
import { createCommandFixture, removeCommandFixtures } from "./testing.js";
import type { CommandFixture } from "./testing.js";
import {
  checkVendorConfig,
  VENDOR_CONFIG_RECOVERY,
  VENDOR_SETTINGS_MAX_BYTES,
} from "./vendor-config.js";

afterEach(removeCommandFixtures);

// Same shape as `SENTINEL` in tests/security/helpers.ts, which this package cannot import.
const SENTINEL = `ghp_${"S3nt1nel".repeat(5)}`;
const CODEX_NOTE = "Codex is not examined: Developer OS never reads the Codex config file";

/** Synthetic rule strings, one per product rule id. Not a claim about Claude's syntax. */
function syntheticObservation(): ClaudeDenyRulesV1 {
  return {
    claudeVersion: "0.0.1",
    observedOn: "2026-01-01",
    observedIn: "synthetic test observation",
    rules: Object.fromEntries(
      PROTECTED_PATH_RULES.map((rule) => [rule.id, [`Read(synthetic-${rule.id})`]]),
    ),
  };
}

const OBSERVED = { observation: syntheticObservation() };

function allRuleStrings(): string[] {
  return Object.values(OBSERVED.observation.rules).flat();
}

async function settingsPath(fixture: CommandFixture): Promise<string> {
  return join(await realpath(fixture.userHome), ".claude", "settings.json");
}

async function plantSettings(fixture: CommandFixture, content: string | Buffer): Promise<string> {
  const path = await settingsPath(fixture);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
  return path;
}

function denySettings(deny: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...extra, permissions: { deny } });
}

describe("checkVendorConfig", () => {
  it("has the pinned bound", () => {
    expect(VENDOR_SETTINGS_MAX_BYTES).toBe(1_048_576);
    expect(PROTECTED_PATH_RULES.length).toBeGreaterThan(0);
  });

  it("warns and reads nothing while the deny-rule syntax is unobserved", async () => {
    const fixture = await createCommandFixture("vendor-config-unobserved");
    await plantSettings(fixture, denySettings(allRuleStrings()));
    const readText = vi.fn(fixture.context.guards.readText);
    const lstat = vi.fn(fixture.context.fs.lstat);
    const context: CliContext = {
      ...fixture.context,
      fs: { ...fixture.context.fs, lstat: lstat as typeof fixture.context.fs.lstat },
      guards: { ...fixture.context.guards, readText },
    };

    const check = await checkVendorConfig(context, { observation: null });

    expect(check.status).toBe("warn");
    expect(check.message).toBe(
      `the Claude deny-rule syntax has not been observed for this product; nothing was compared; ${CODEX_NOTE}`,
    );
    expect(readText).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
  });

  it("passes when every rule string is present", async () => {
    const fixture = await createCommandFixture("vendor-config-pass");
    await plantSettings(fixture, denySettings(allRuleStrings()));

    const check = await checkVendorConfig(fixture.context, OBSERVED);

    expect(check.status).toBe("pass");
    expect(check.message.endsWith(CODEX_NOTE)).toBe(true);
  });

  it("names exactly the missing rule ids, sorted, with the recovery text", async () => {
    const fixture = await createCommandFixture("vendor-config-missing");
    const ids = PROTECTED_PATH_RULES.map((rule) => rule.id);
    expect(ids.length).toBeGreaterThan(2);
    const dropped = [ids[ids.length - 1], ids[0]] as string[];
    const kept = Object.entries(OBSERVED.observation.rules)
      .filter(([id]) => !dropped.includes(id))
      .flatMap(([, strings]) => strings);
    await plantSettings(fixture, denySettings(kept));

    const check = await checkVendorConfig(fixture.context, OBSERVED);

    expect(check.status).toBe("warn");
    expect(check.message).toBe(
      `missing Claude deny rules: ${[...dropped].sort().join(", ")}; ${CODEX_NOTE}`,
    );
    expect(check.recovery).toBe(
      "add these deny rules to your Claude user settings; Developer OS never writes that file",
    );
    expect(VENDOR_CONFIG_RECOVERY).toBe(check.recovery);
  });

  it("warns when the file is absent", async () => {
    const fixture = await createCommandFixture("vendor-config-absent");

    const check = await checkVendorConfig(fixture.context, OBSERVED);

    expect(check.status).toBe("warn");
    expect(check.message.endsWith(CODEX_NOTE)).toBe(true);
  });

  it("reads a file at the bound and warns one byte past it", async () => {
    const fixture = await createCommandFixture("vendor-config-bound");
    const body = denySettings(allRuleStrings());
    await plantSettings(fixture, body.padEnd(VENDOR_SETTINGS_MAX_BYTES, " "));
    expect((await checkVendorConfig(fixture.context, OBSERVED)).status).toBe("pass");

    await plantSettings(fixture, body.padEnd(VENDOR_SETTINGS_MAX_BYTES + 1, " "));
    const over = await checkVendorConfig(fixture.context, OBSERVED);
    expect(over.status).toBe("warn");
    expect(over.message.endsWith(CODEX_NOTE)).toBe(true);
  });

  it("warns with a fixed message and no input fragment on invalid JSON", async () => {
    const fixture = await createCommandFixture("vendor-config-invalid");
    await plantSettings(fixture, `{"permissions": {"deny": ["${SENTINEL}"`);

    const check = await checkVendorConfig(fixture.context, OBSERVED);

    expect(check.status).toBe("warn");
    expect(check.message).toBe(`the Claude user settings file is not valid JSON; ${CODEX_NOTE}`);
    expect(JSON.stringify(check)).not.toContain(SENTINEL);
  });

  it.each([
    ["an object", { rules: "Read(x)" }],
    ["an array holding a number", ["Read(x)", 7]],
  ])("warns when permissions.deny is %s", async (_label, deny) => {
    const fixture = await createCommandFixture("vendor-config-shape");
    await plantSettings(fixture, denySettings(deny));

    const check = await checkVendorConfig(fixture.context, OBSERVED);

    expect(check.status).toBe("warn");
    expect(check.message.endsWith(CODEX_NOTE)).toBe(true);
  });

  it("is value-free: no allow, env or deny string reaches the check", async () => {
    const fixture = await createCommandFixture("vendor-config-value-free");
    await plantSettings(
      fixture,
      JSON.stringify({
        env: { TOKEN: SENTINEL },
        permissions: { allow: [SENTINEL], deny: [SENTINEL, ...allRuleStrings()] },
      }),
    );

    const check = await checkVendorConfig(fixture.context, OBSERVED);

    expect(check.status).toBe("pass");
    expect(JSON.stringify(check)).not.toContain(SENTINEL);
  });

  it.each([[["doctor"]], [["doctor", "--json"]]])(
    "is value-free through %j",
    async (argv) => {
      const fixture = await createCommandFixture("vendor-config-value-free-run");
      expect((await runInit(fixture.context, { dryRun: false, assumeYes: true })).ok).toBe(true);
      await plantSettings(
        fixture,
        JSON.stringify({
          env: { TOKEN: SENTINEL },
          permissions: { allow: [SENTINEL], deny: [SENTINEL] },
        }),
      );
      fixture.io.out.length = 0;
      fixture.io.err.length = 0;

      await run(argv, fixture.io, () => fixture.context);

      const lines = [...fixture.io.out, ...fixture.io.err];
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).not.toContain(SENTINEL);
    },
    120_000,
  );

  it("warns instead of failing when the read throws", async () => {
    const fixture = await createCommandFixture("vendor-config-throws");
    await plantSettings(fixture, denySettings(allRuleStrings()));
    const context: CliContext = {
      ...fixture.context,
      guards: {
        ...fixture.context.guards,
        readText: () => Promise.reject(new Error("boom")),
      },
    };

    const check = await checkVendorConfig(context, OBSERVED);

    expect(check.status).toBe("warn");
    expect(check.message).toBe(`the Claude user settings could not be read; ${CODEX_NOTE}`);
    expect(doctorExitCode([{ check, code: EXIT_CODES.success }])).toBe(EXIT_CODES.success);
  });
});
