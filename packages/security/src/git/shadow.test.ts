import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";

import { hashCanonicalJson, parseCanonicalAbsolutePathText, type CanonicalJsonValue } from "@developer-os/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SecurityRefusalError } from "../paths.js";
import { parseGitConfigQuotedPath } from "./process-table.js";
import {
  bindShadowConfigToTemplate,
  createOpaqueGitLocalToken,
  deslotShadowConfig,
  hashShadowConfig,
  hashShadowConfigTemplate,
  instantiateShadowConfig,
  materializeSanitizedBareDestinationShadow,
  materializeSanitizedGitShadow,
  parseOpaqueGitLocalToken,
  renderGitConfigQuoted,
  validateShadowConfig,
  validateShadowConfigTemplate,
  verifySanitizedGitShadow,
  type SanitizedGitShadowConfigTemplateV1,
  type SanitizedGitShadowSlotsV1,
} from "./shadow.js";

const gitConfigQuotedPath = parseGitConfigQuotedPath;
const renderQuoted = renderGitConfigQuoted;
const character = (codePoint: number): string => String.fromCodePoint(codePoint);
const UID = process.getuid?.() ?? 0;
const TOKEN = parseOpaqueGitLocalToken("e".repeat(64));

const FIXED = {
  schemaVersion: 1,
  commit: { gpgSign: false },
  tag: { gpgSign: false },
  gc: { auto: 0 },
  maintenance: { auto: false },
  http: { proxy: "", followRedirects: false },
  credential: { helper: "" },
} as const;

const template = validateShadowConfigTemplate({
  ...FIXED,
  kind: "source",
  core: { repositoryFormatVersion: 0, fileMode: true, bare: false, hooksPath: { slot: "hooks_directory" }, fsmonitor: false },
  remote: { name: "developer-os", url: { kind: "literal", value: "https://example.invalid/synthetic/brain.git" } },
  receive: null,
});
const localTemplate = validateShadowConfigTemplate({
  ...template,
  remote: { name: "developer-os", url: { kind: "slot", slot: "opaque_local_selector" } },
});
const destinationTemplate = validateShadowConfigTemplate({
  ...FIXED,
  kind: "bare_destination",
  core: { repositoryFormatVersion: 0, fileMode: true, bare: true, hooksPath: { slot: "hooks_directory" }, fsmonitor: false },
  remote: null,
  receive: { unpackLimit: 0, denyNonFastForwards: true, denyDeletes: false },
});
const slots: SanitizedGitShadowSlotsV1 = {
  hooksDirectory: gitConfigQuotedPath("/tmp/developer-os-test/shadow/hooks"),
  opaqueLocalToken: null,
};

const SOURCE_BYTES = [
  "[core]",
  "\trepositoryformatversion = 0",
  "\tfilemode = true",
  "\tbare = false",
  '\thooksPath = "/tmp/developer-os-test/shadow/hooks"',
  "\tfsmonitor = false",
  "[commit]",
  "\tgpgSign = false",
  "[tag]",
  "\tgpgSign = false",
  "[gc]",
  "\tauto = 0",
  "[maintenance]",
  "\tauto = false",
  "[http]",
  "\tproxy =",
  "\tfollowRedirects = false",
  "[credential]",
  "\thelper =",
  '[remote "developer-os"]',
  '\turl = "https://example.invalid/synthetic/brain.git"',
  "",
].join("\n");

const DESTINATION_TAIL = ["[receive]", "\tunpackLimit = 0", "\tdenyNonFastForwards = true", "\tdenyDeletes = false", ""].join("\n");

const bytesDigest = (text: string): string =>
  createHash("sha256").update("developer-os:git-shadow-config:v1\0", "ascii").update(text, "utf8").digest("hex");

describe("SanitizedGitShadowConfigBytesV1", () => {
  it("renders one domain-bound config template to exact bytes", () => {
    const concrete = instantiateShadowConfig(template, slots);
    expect(concrete.bytes).toBe(SOURCE_BYTES);
    expect(hashShadowConfig(concrete.bytes)).toBe(bytesDigest(SOURCE_BYTES));
    expect(concrete.configBytesHash).toBe(bytesDigest(SOURCE_BYTES));
    expect(concrete.bytes).toContain("[http]\n\tproxy =\n\tfollowRedirects = false\n");
    expect(concrete.templateHash).toBe(hashCanonicalJson("developer-os:git-shadow-config-template:v1", template as unknown as CanonicalJsonValue));
  });

  it("renders the bare-destination arm with the receive pins and no remote", () => {
    const concrete = instantiateShadowConfig(destinationTemplate, slots);
    expect(concrete.bytes.endsWith(`\thelper =\n${DESTINATION_TAIL}`)).toBe(true);
    expect(concrete.bytes).not.toContain("[remote");
  });

  it("counts exactly the fixed config entries and nothing command-bearing", () => {
    const keyLines = (text: string): string[] => text.split("\n").filter((line) => line.startsWith("\t"));
    expect(keyLines(instantiateShadowConfig(template, slots).bytes)).toHaveLength(13);
    expect(keyLines(instantiateShadowConfig(destinationTemplate, slots).bytes)).toHaveLength(15);
    const forbidden = ["pushurl", "insteadOf", "include", "sshCommand", "askPass", "editor", "pager", "procReceiveRefs", "filter", "\r", "#", ";"];
    for (const bytes of [instantiateShadowConfig(template, slots).bytes, instantiateShadowConfig(destinationTemplate, slots).bytes]) {
      for (const needle of forbidden) expect(bytes).not.toContain(needle);
      expect(bytes.endsWith("\n")).toBe(true);
      expect(bytes).not.toContain("\n\n");
    }
  });

  const quotedPathBoundaries = ["\n", "\r", "\u0000", character(0x85), "\u001b", character(0x2028), character(0x7f)];

  it.each(quotedPathBoundaries)("refuses a quoted path containing %j", (byte) => {
    expect(quotedPathBoundaries.length).toBeGreaterThan(0);
    expect(() => gitConfigQuotedPath(`/Users/a${byte}b`)).toThrow();
    expect(() => instantiateShadowConfig(template, { ...slots, hooksDirectory: `/Users/a${byte}b` as never })).toThrow();
  });

  it("round-trips a quote path with spaces/non-ASCII through the sole escape grammar", () => {
    expect(renderQuoted(gitConfigQuotedPath('/Users/a b/é"x'))).toBe('"/Users/a b/é\\"x"');
    expect(renderQuoted('/Users/a b/é"\\x')).toBe('"/Users/a b/é\\"\\\\x"');
  });

  it("refuses a backslash path before rendering, because CanonicalAbsolutePathV1 already excludes it", () => {
    expect(() => gitConfigQuotedPath("/Users/a\\b")).toThrow();
  });

  it("refuses every extra, missing or widened key", () => {
    const projection = instantiateShadowConfig(template, slots).configProjection;
    const widened: readonly unknown[] = [
      { ...projection, include: { path: "/tmp/x" } },
      { ...projection, core: { ...projection.core, sshCommand: "sh" } },
      { ...projection, http: { ...projection.http, followRedirects: true } },
      { ...projection, http: { ...projection.http, proxy: "http://proxy.invalid" } },
      { ...projection, credential: { helper: "store" } },
      { ...projection, remote: { ...projection.remote, pushurl: "https://other.invalid/x.git" } },
      { ...projection, remote: { name: "developer-os", url: "ext::sh -c id" } },
      { ...projection, remote: { name: "developer-os", url: "file:///tmp/developer-os-test/remote.git" } },
      { ...projection, receive: { unpackLimit: 0, denyNonFastForwards: true, denyDeletes: true } },
      { ...projection, core: { ...projection.core, fsmonitor: true } },
      { ...projection, gc: { auto: 1 } },
      { ...projection, maintenance: { auto: true } },
      { ...projection, commit: { gpgSign: true } },
    ];
    expect(widened.length).toBeGreaterThan(0);
    for (const value of widened) expect(() => validateShadowConfig(value)).toThrow();
  });
});

describe("template instantiation", () => {
  it("re-instantiates the path-slot template after a restart to the same template hash", () => {
    const first = instantiateShadowConfig(localTemplate, { hooksDirectory: gitConfigQuotedPath("/tmp/a/hooks"), opaqueLocalToken: TOKEN });
    const second = instantiateShadowConfig(localTemplate, {
      hooksDirectory: gitConfigQuotedPath("/tmp/b/hooks"),
      opaqueLocalToken: createOpaqueGitLocalToken(() => new Uint8Array(32).fill(7)),
    });
    expect(first.templateHash).toBe(second.templateHash);
    expect(first.configBytesHash).not.toBe(second.configBytesHash);
    expect(deslotShadowConfig(second.configProjection)).toEqual(localTemplate);
    expect(hashShadowConfigTemplate(deslotShadowConfig(first.configProjection))).toBe(first.templateHash);
    expect(bindShadowConfigToTemplate(first.templateHash, localTemplate, { ...slots, opaqueLocalToken: TOKEN }).templateHash).toBe(first.templateHash);
  });

  it("binds a local source only through the internal selector, never a real path", () => {
    const concrete = instantiateShadowConfig(localTemplate, { ...slots, opaqueLocalToken: TOKEN });
    expect(concrete.configProjection.remote?.url).toBe(`developer-os-local::${TOKEN}`);
    expect(concrete.bytes).toContain(`\turl = "developer-os-local::${TOKEN}"\n`);
    expect(concrete.bytes).not.toContain("file:");
  });

  it("refuses a slot that does not belong to the template and a template bound to another hash", () => {
    expect(() => instantiateShadowConfig(template, { ...slots, opaqueLocalToken: TOKEN })).toThrow(SecurityRefusalError);
    expect(() => instantiateShadowConfig(localTemplate, slots)).toThrow(SecurityRefusalError);
    expect(() => bindShadowConfigToTemplate(hashShadowConfigTemplate(localTemplate), template, slots)).toThrow("git_shadow_template_mismatch");
  });

  it("refuses a template with a local literal URL, an extra key or the wrong arm", () => {
    const bad: readonly unknown[] = [
      { ...template, remote: { name: "developer-os", url: { kind: "literal", value: "file:///tmp/remote.git" } } },
      { ...template, remote: { name: "developer-os", url: { kind: "slot", slot: "hooks_directory" } } },
      { ...template, extra: true },
      { ...template, receive: destinationTemplate.receive },
      { ...destinationTemplate, remote: template.remote },
      { ...template, core: { ...template.core, hooksPath: "/tmp/hooks" } },
    ];
    expect(bad.length).toBeGreaterThan(0);
    for (const value of bad) expect(() => validateShadowConfigTemplate(value as SanitizedGitShadowConfigTemplateV1)).toThrow();
  });
});

describe("materialized shadows", () => {
  let root: string;
  const HEAD = new TextEncoder().encode("ref: refs/heads/main\n");
  const REF = new TextEncoder().encode(`${"a".repeat(40)}\n`);

  beforeEach(async () => {
    root = await nodeFs.realpath(await nodeFs.mkdtemp(`${tmpdir()}/developer-os-shadow-`));
  });

  afterEach(async () => {
    await nodeFs.rm(root, { recursive: true, force: true });
  });

  it("binds an owner-only config, an empty hooks directory and the snapshots by identity", async () => {
    const shadow = await materializeSanitizedGitShadow({
      gitDir: parseCanonicalAbsolutePathText(`${root}/source`),
      template,
      opaqueLocalToken: null,
      head: HEAD,
      refs: [{ ref: "refs/heads/team/main", bytes: REF }],
      effectiveUid: UID,
    });
    expect(shadow.kind).toBe("source");
    expect(await nodeFs.readFile(shadow.configPath, "utf8")).toBe(shadow.bytes);
    expect((await nodeFs.stat(shadow.configPath)).mode & 0o777).toBe(0o600);
    expect((await nodeFs.stat(shadow.hooksPath)).mode & 0o777).toBe(0o700);
    expect(await nodeFs.readdir(shadow.hooksPath)).toEqual([]);
    expect(await nodeFs.readFile(`${shadow.gitDir}/refs/heads/team/main`)).toEqual(Buffer.from(REF));
    expect(shadow.configIdentity.ino).toMatch(/^[0-9]+$/u);
    await expect(verifySanitizedGitShadow(shadow, UID)).resolves.toBeUndefined();
  });

  it("detects a planted hook, a swapped config and a replaced hooks directory", async () => {
    const make = (name: string) =>
      materializeSanitizedBareDestinationShadow({
        gitDir: parseCanonicalAbsolutePathText(`${root}/${name}`),
        template: destinationTemplate,
        opaqueLocalToken: null,
        head: HEAD,
        refs: [],
        effectiveUid: UID,
      });
    const hooked = await make("hooked");
    await nodeFs.writeFile(`${hooked.hooksPath}/pre-receive`, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await expect(verifySanitizedGitShadow(hooked, UID)).rejects.toThrow("git_shadow_hooks_changed");

    const swapped = await make("swapped");
    await nodeFs.writeFile(`${swapped.gitDir}/config.swap`, swapped.bytes, { mode: 0o600 });
    await nodeFs.rename(`${swapped.gitDir}/config.swap`, swapped.configPath);
    await expect(verifySanitizedGitShadow(swapped, UID)).rejects.toThrow("git_shadow_config_changed");

    const edited = await make("edited");
    await nodeFs.appendFile(edited.configPath, "[core]\n\tsshCommand = sh\n");
    await expect(verifySanitizedGitShadow(edited, UID)).rejects.toThrow(SecurityRefusalError);
  });

  it("refuses an existing shadow path, the wrong template kind and over-bound snapshots", async () => {
    const request = {
      gitDir: parseCanonicalAbsolutePathText(`${root}/exists`),
      template,
      opaqueLocalToken: null,
      head: HEAD,
      refs: [],
      effectiveUid: UID,
    };
    await nodeFs.mkdir(request.gitDir);
    await expect(materializeSanitizedGitShadow(request)).rejects.toThrow("git_shadow_path_exists");
    const fresh = { ...request, gitDir: parseCanonicalAbsolutePathText(`${root}/fresh`) };
    await expect(materializeSanitizedBareDestinationShadow(fresh)).rejects.toThrow("git_shadow_kind_mismatch");
    await expect(materializeSanitizedGitShadow({ ...fresh, head: new Uint8Array(4097) })).rejects.toThrow("git_shadow_snapshot_bounds");
    await expect(
      materializeSanitizedGitShadow({ ...fresh, refs: [{ ref: "refs/heads/main", bytes: new Uint8Array(42) }] }),
    ).rejects.toThrow("git_shadow_snapshot_bounds");
    await expect(nodeFs.access(fresh.gitDir)).rejects.toThrow();
  });
});
