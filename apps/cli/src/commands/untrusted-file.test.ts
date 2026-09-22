import { mkdir, symlink, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { EXIT_CODES } from "@developer-os/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliContext } from "../context.js";
import {
  createCommandFixture,
  removeCommandFixtures,
  type CommandFixture,
} from "./testing.js";
import {
  readUntrustedText,
  UntrustedFileRefusal,
  type UntrustedFileReason,
} from "./untrusted-file.js";

afterEach(removeCommandFixtures);

// Same shape as `SENTINEL` in tests/security/helpers.ts, which this package cannot import.
const SENTINEL = `ghp_${"S3nt1nel".repeat(5)}`;
const BOUND = 64;

type ReaderContext = Pick<CliContext, "fs" | "guards">;

interface Harness {
  readonly fixture: CommandFixture;
  readonly project: string;
  readonly context: ReaderContext;
  readonly readText: ReturnType<typeof vi.fn>;
  readonly readRequests: number[];
}

async function harness(label: string): Promise<Harness> {
  const fixture = await createCommandFixture(label);
  const project = join(fixture.userHome, "project");
  await mkdir(project, { recursive: true });
  const readRequests: number[] = [];
  const base = fixture.context.guards;
  const readText = vi.fn(
    (path: string, reader?: (handle: FileHandle) => Promise<string>) =>
      base.readText(path, async (handle) => {
        const original = handle.read.bind(handle);
        vi.spyOn(handle, "read").mockImplementation(((
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          readRequests.push(length);
          return original(buffer, offset, length, position);
        }) as FileHandle["read"]);
        if (reader === undefined) throw new Error("the reader must pass its own reader");
        return reader(handle);
      }),
  );
  return {
    fixture,
    project,
    context: { fs: fixture.context.fs, guards: { ...base, readText } },
    readText,
    readRequests,
  };
}

async function refusal(
  promise: Promise<unknown>,
  reason: UntrustedFileReason,
  code: number,
): Promise<UntrustedFileRefusal> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(UntrustedFileRefusal);
  expect(error).toMatchObject({ reason, code });
  return error as UntrustedFileRefusal;
}

describe("readUntrustedText", () => {
  it("reads a regular UTF-8 file at the bound exactly", async () => {
    const h = await harness("untrusted-at-bound");
    const path = join(h.project, "note.md");
    const text = "é".repeat(BOUND / 2);
    await writeFile(path, text, "utf8");

    await expect(readUntrustedText(h.context, path, BOUND)).resolves.toBe(text);
    expect(h.readRequests.length).toBeGreaterThan(0);
    expect(Math.max(...h.readRequests)).toBeLessThanOrEqual(BOUND + 1);
  });

  it("refuses one byte past the bound as too_large, never asking for more than bound + 1 bytes", async () => {
    const h = await harness("untrusted-past-bound");
    const path = join(h.project, "note.md");
    await writeFile(path, "a".repeat(BOUND + 1), "utf8");

    await refusal(readUntrustedText(h.context, path, BOUND), "too_large", EXIT_CODES.operationalFailure);
    expect(h.readRequests.length).toBeGreaterThan(0);
    expect(h.readRequests.reduce((sum, length) => sum + length, 0)).toBeLessThanOrEqual(BOUND + 1);
  });

  it("never requests more than bound + 1 bytes from a much larger file", async () => {
    const h = await harness("untrusted-large");
    const path = join(h.project, "note.md");
    await writeFile(path, "a".repeat(BOUND * 100), "utf8");

    await refusal(readUntrustedText(h.context, path, BOUND), "too_large", EXIT_CODES.operationalFailure);
    expect(h.readRequests.length).toBeGreaterThan(0);
    expect(h.readRequests.reduce((sum, length) => sum + length, 0)).toBeLessThanOrEqual(BOUND + 1);
  });

  it.each([
    ["invalid UTF-8", Buffer.from([0xc3, 0x28])],
    ["a NUL byte", Buffer.from("before\0after", "utf8")],
  ])("refuses %s as not_text", async (_label, bytes) => {
    const h = await harness("untrusted-not-text");
    const path = join(h.project, "note.md");
    await writeFile(path, bytes);

    await refusal(readUntrustedText(h.context, path, BOUND), "not_text", EXIT_CODES.operationalFailure);
  });

  it("refuses a symlink without reading its target", async () => {
    const h = await harness("untrusted-symlink");
    const target = join(h.project, "target.md");
    const link = join(h.project, "link.md");
    await writeFile(target, SENTINEL, "utf8");
    await symlink(target, link);

    const error = await refusal(
      readUntrustedText(h.context, link, BOUND),
      "symlink",
      EXIT_CODES.securityRefusal,
    );
    expect(h.readText).not.toHaveBeenCalled();
    expect(error.message).not.toContain(SENTINEL);
  });

  it("refuses a directory as not_regular", async () => {
    const h = await harness("untrusted-directory");
    const path = join(h.project, "folder");
    await mkdir(path);

    await refusal(readUntrustedText(h.context, path, BOUND), "not_regular", EXIT_CODES.operationalFailure);
    expect(h.readText).not.toHaveBeenCalled();
  });

  it("refuses a missing path as not_found", async () => {
    const h = await harness("untrusted-missing");

    await refusal(
      readUntrustedText(h.context, join(h.project, "absent.md"), BOUND),
      "not_found",
      EXIT_CODES.invalidInput,
    );
    expect(h.readText).not.toHaveBeenCalled();
  });

  it("refuses protected paths before any open", async () => {
    const h = await harness("untrusted-protected");
    const env = join(h.project, ".env");
    const ssh = join(h.fixture.userHome, ".ssh", "config");
    await writeFile(env, SENTINEL, "utf8");
    await mkdir(join(h.fixture.userHome, ".ssh"), { recursive: true });
    await writeFile(ssh, SENTINEL, "utf8");
    const protectedPaths = [env, ssh];
    expect(protectedPaths.length).toBeGreaterThan(0);

    for (const path of protectedPaths) {
      await refusal(readUntrustedText(h.context, path, BOUND), "protected", EXIT_CODES.securityRefusal);
    }
    expect(h.readText).toHaveBeenCalledTimes(0);
  });

  it("throws a RangeError for a relative path", async () => {
    const h = await harness("untrusted-relative");

    await expect(readUntrustedText(h.context, "project/note.md", BOUND)).rejects.toBeInstanceOf(
      RangeError,
    );
    expect(h.readText).not.toHaveBeenCalled();
  });

  it("never puts file content in the refusal message", async () => {
    const h = await harness("untrusted-no-content");
    const path = join(h.project, "note.md");
    await writeFile(path, SENTINEL.repeat(10), "utf8");

    const error = await refusal(
      readUntrustedText(h.context, path, SENTINEL.length),
      "too_large",
      EXIT_CODES.operationalFailure,
    );
    expect(error.message).not.toContain(SENTINEL);
    expect(error.message).not.toContain(path);
  });
});
