import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { dirname } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES, parseCanonicalAbsolutePathText } from "@developer-os/core";
import type { InstallationManifestV2 } from "@developer-os/core";

import { failureFrom } from "../../context.js";
import { entrypointPath } from "../../update/local-release.js";
import { createCommandFixture, inventoryDigest, removeCommandFixtures } from "../testing.js";
import type { CommandFixture } from "../testing.js";
import { AutomationCommandRefusal, createAutomationService, verifiedAutomationExecutable } from "./service.js";

afterEach(removeCommandFixtures);

const ENTRYPOINT = "// synthetic entrypoint\n";

function lifecycleOf(fixture: CommandFixture): NonNullable<CommandFixture["context"]["lifecycle"]> {
  const lifecycle = fixture.context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  return lifecycle;
}

function manifestWith(rows: readonly object[]): InstallationManifestV2 {
  return { artifacts: rows } as unknown as InstallationManifestV2;
}

function entrypointRow(path: string, installedHash: string, owner = "core"): object {
  return { owner, path, kind: "file", verification: { mode: "content", installedHash } };
}

describe("AutomationCommandRefusal", () => {
  it("publishes its reason as the failure kind", () => {
    const refusal = new AutomationCommandRefusal("automation_already_disabled", EXIT_CODES.invalidInput, ["/synthetic/config.toml"]);
    const result = failureFrom({ guards: { redactDiagnostic: (text: string) => text } } as never, refusal, refusal.paths);
    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.invalidInput, error: { kind: "automation_already_disabled" } });
  });
});

describe("createAutomationService", () => {
  it("refuses every preview on a home with no installation, before any observation or write", async () => {
    const fixture = await createCommandFixture("automation-no-install");
    await nodeFs.mkdir(fixture.paths.home, { recursive: true, mode: 0o700 });
    const before = await inventoryDigest(fixture.root);
    const service = createAutomationService(fixture.context, lifecycleOf(fixture));

    await expect(service.previewEnable(["doctor=daily@02:00"])).rejects.toMatchObject({ reason: "manifest_absent" });
    await expect(service.previewDisable()).rejects.toMatchObject({ reason: "manifest_absent" });
    await expect(service.status()).rejects.toMatchObject({ reason: "manifest_absent" });
    expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
  });
});

describe("verifiedAutomationExecutable", () => {
  it("names the installed entrypoint only when its core content row and bytes agree", async () => {
    const fixture = await createCommandFixture("automation-executable");
    const lifecycle = lifecycleOf(fixture);
    const productHome = parseCanonicalAbsolutePathText(fixture.paths.home);
    const path = entrypointPath(productHome);
    await nodeFs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(path, ENTRYPOINT, { mode: 0o600 });
    const hash = createHash("sha256").update(ENTRYPOINT).digest("hex");

    expect(await verifiedAutomationExecutable(lifecycle, productHome, manifestWith([entrypointRow(path, hash)]))).toBe(path);
    await expect(verifiedAutomationExecutable(lifecycle, productHome, manifestWith([]))).rejects.toMatchObject({
      reason: "automation_executable_unavailable",
      code: EXIT_CODES.capabilityUnavailable,
    });
    await expect(verifiedAutomationExecutable(lifecycle, productHome, manifestWith([entrypointRow(path, hash, "macos")]))).rejects.toMatchObject({
      reason: "automation_executable_unavailable",
    });
    await expect(verifiedAutomationExecutable(lifecycle, productHome, manifestWith([entrypointRow(path, "0".repeat(64))]))).rejects.toMatchObject({
      reason: "automation_executable_drifted",
      code: EXIT_CODES.recoveryRequired,
    });
  });
});
