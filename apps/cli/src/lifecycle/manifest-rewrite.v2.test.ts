import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { decodeCanonicalJson, encodeCanonicalJson, hashBytes, validateManifestBytes } from "@developer-os/core";
import type { CanonicalJsonValue, InstallationManifestV2 } from "@developer-os/core";

import { runInit } from "../commands/init.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../commands/testing.js";
import { manifestAdmissionFor } from "./manifest-admission.js";
import { withLifecycleMutation } from "./mutation-gate.js";

const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

afterAll(removeCommandFixtures);

/**
 * Spec §6.1: the attach and detach planners (Tasks 16–19) rewrite the manifest with an ordinary
 * gated standalone transaction, not through the lifecycle coordinator. If this case fails, the
 * phase stops for a founder decision instead of rerouting those tasks.
 */
describe("the installation manifest as an ordinary gated transaction target", () => {
  it("commits a guarded replace that adds an instruction content row and re-admits the home", async () => {
    const fixture = await createCommandFixture("manifest-rewrite", { bootstrapAvailable: true });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const init = await runInit(fixture.context, { dryRun: false, assumeYes: true });
    expect(init.ok).toBe(true);
    const lifecycle = fixture.context.lifecycle;
    if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");

    const manifestFile = fixture.paths.manifestFile;
    const before = new Uint8Array(await nodeFs.readFile(manifestFile));
    const manifest = decodeCanonicalJson(before, MAX_MANIFEST_BYTES) as unknown as InstallationManifestV2;
    const [template] = manifest.artifacts;
    if (template === undefined) throw new Error("the fresh manifest holds no artifact");

    const target = join(fixture.paths.home, "instruction-probe.md");
    const content = new TextEncoder().encode("# probe\n");
    const row = {
      owner: "claude",
      path: target,
      productVersion: template.productVersion,
      existedBefore: false,
      beforeHash: null,
      backupRelativePath: null,
      source: template.source,
      mergeStrategy: "dedicated",
      verifiedAt: template.verifiedAt,
      kind: "instruction",
      instruction: { category: "skill", id: "manifest-rewrite-probe", source: "default" },
      verification: { mode: "content", installedHash: hashBytes(content) },
    };
    const artifacts = [...manifest.artifacts, row].sort((a, b) =>
      Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
    );
    const after = new TextEncoder().encode(
      encodeCanonicalJson({ ...manifest, artifacts } as unknown as CanonicalJsonValue),
    );

    await withLifecycleMutation(fixture.context, lifecycle, () =>
      fixture.context.executor.execute({
        kind: "instructions",
        mutations: [
          { targetPath: target, operation: "create", content },
          { targetPath: manifestFile, operation: "replace", content: after, expectedBeforeHash: hashBytes(before) },
        ],
      }),
    );

    const written = new Uint8Array(await nodeFs.readFile(manifestFile));
    expect(written).toStrictEqual(after);
    const admitted = validateManifestBytes(written, manifestAdmissionFor(fixture.paths, []));
    expect(admitted.schemaVersion).toBe(2);
    expect((admitted as InstallationManifestV2).artifacts.filter((artifact) => artifact.path === target)).toStrictEqual([row]);

    await expect(withLifecycleMutation(fixture.context, lifecycle, () => Promise.resolve("admitted"))).resolves.toBe("admitted");
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
