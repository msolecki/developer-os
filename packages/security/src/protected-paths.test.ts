import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT_CODES } from "@developer-os/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProtectedPathPolicy } from "./protected-paths.js";

const syntheticHome = "/Users/test";
const temporaryDirectories = new Set<string>();
const protectedPaths = [
  "/Users/test/.env",
  "/Users/test/.env.local",
  "/Users/test/.ssh/id_ed25519",
  "/Users/test/.config/gh/hosts.yml",
  "/Users/test/.codex/auth.json",
  "/Users/test/.claude/.credentials.json",
  "/Users/test/.aws/credentials",
  "/Users/test/.gnupg/private-keys-v1.d/key",
] as const;

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "developer-os-protected-paths-"),
  );
  temporaryDirectories.add(directory);
  return directory;
}

afterEach(async () => {
  const exactDirectories = [...temporaryDirectories];
  temporaryDirectories.clear();
  await Promise.all(
    exactDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ProtectedPathPolicy", () => {
  it.each(protectedPaths)(
    "rejects reading the protected path %s",
    async (protectedPath) => {
      const policy = new ProtectedPathPolicy(syntheticHome);

      await expect(policy.assertReadable(protectedPath)).rejects.toMatchObject({
        code: EXIT_CODES.securityRefusal,
      });
    },
  );

  it.each(protectedPaths)(
    "rejects writing the protected path %s",
    async (protectedPath) => {
      const policy = new ProtectedPathPolicy(syntheticHome);

      await expect(policy.assertWritable(protectedPath)).rejects.toMatchObject({
        code: EXIT_CODES.securityRefusal,
      });
    },
  );

  it("allows the Developer OS configuration path", async () => {
    const policy = new ProtectedPathPolicy(syntheticHome);
    const allowedPath = "/Users/test/.developer-os/config.toml";

    await expect(policy.assertReadable(allowedPath)).resolves.toBeUndefined();
    await expect(policy.assertWritable(allowedPath)).resolves.toBeUndefined();
  });

  it("does not treat a protected-name prefix as the protected directory", async () => {
    const policy = new ProtectedPathPolicy(syntheticHome);
    const allowedPath = "/Users/test/.ssh-notes/file";

    await expect(policy.assertReadable(allowedPath)).resolves.toBeUndefined();
    await expect(policy.assertWritable(allowedPath)).resolves.toBeUndefined();
  });

  it("awaits a protected-path refusal before invoking the injected reader", async () => {
    const policy = new ProtectedPathPolicy(syntheticHome);
    const reader = vi.fn(() => Promise.resolve("must-not-be-read"));

    await expect(
      policy.readText("/Users/test/.codex/auth.json", reader),
    ).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
    expect(reader).not.toHaveBeenCalled();
  });

  it("reads allowed file bytes through the default descriptor reader", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const home = join(temporaryDirectory, "synthetic-home");
    const allowedDirectory = join(home, ".developer-os");
    const allowedFile = join(allowedDirectory, "config.toml");
    const safeContent = "synthetic allowed configuration";
    await mkdir(allowedDirectory, { recursive: true });
    await writeFile(allowedFile, safeContent, "utf8");
    const policy = new ProtectedPathPolicy(home);

    await expect(policy.readText(allowedFile)).resolves.toBe(safeContent);
  });

  it("rejects an innocent alias outside home that resolves to synthetic auth data", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const home = join(temporaryDirectory, "synthetic-home");
    const protectedDirectory = join(home, ".codex");
    const protectedFile = join(protectedDirectory, "auth.json");
    const innocentAlias = join(temporaryDirectory, "innocent-note.txt");
    await mkdir(protectedDirectory, { recursive: true });
    await writeFile(protectedFile, "synthetic protected text", "utf8");
    await symlink(protectedFile, innocentAlias);
    const policy = new ProtectedPathPolicy(home);
    const reader = vi.fn(() => Promise.resolve("must-not-be-read"));

    await expect(policy.assertReadable(innocentAlias)).rejects.toMatchObject({
      code: EXIT_CODES.securityRefusal,
    });
    await expect(
      policy.readText(innocentAlias, reader),
    ).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
    expect(reader).not.toHaveBeenCalled();
  });

  it("rejects an innocent alias that resolves into synthetic SSH data", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const home = join(temporaryDirectory, "synthetic-home");
    const protectedDirectory = join(home, ".ssh");
    const protectedFile = join(protectedDirectory, "synthetic-entry.txt");
    const innocentAlias = join(temporaryDirectory, "innocent-profile.txt");
    await mkdir(protectedDirectory, { recursive: true });
    await writeFile(protectedFile, "synthetic protected text", "utf8");
    await symlink(protectedFile, innocentAlias);
    const policy = new ProtectedPathPolicy(home);

    await expect(policy.assertReadable(innocentAlias)).rejects.toMatchObject({
      code: EXIT_CODES.securityRefusal,
    });
  });

  it("reads from the opened safe descriptor after the original alias is swapped", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const home = join(temporaryDirectory, "synthetic-home");
    const protectedDirectory = join(home, ".codex");
    const safeFile = join(home, "safe-note.txt");
    const protectedFile = join(protectedDirectory, "auth.json");
    const innocentAlias = join(temporaryDirectory, "innocent-alias.txt");
    const safeContent = "synthetic safe bytes";
    await mkdir(protectedDirectory, { recursive: true });
    await writeFile(safeFile, safeContent, "utf8");
    await writeFile(protectedFile, "synthetic protected bytes", "utf8");
    await symlink(safeFile, innocentAlias);
    const policy = new ProtectedPathPolicy(home);

    const result = await policy.readText(
      innocentAlias,
      async (handle: FileHandle) => {
        await unlink(innocentAlias);
        await symlink(protectedFile, innocentAlias);
        return handle.readFile({ encoding: "utf8" });
      },
    );

    expect(result).toBe(safeContent);
    expect(result).not.toContain("synthetic protected bytes");
  });

  it("closes the opened handle after the injected callback completes", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const home = join(temporaryDirectory, "synthetic-home");
    const allowedFile = join(home, "safe-note.txt");
    const safeContent = "synthetic handle lifecycle bytes";
    await mkdir(home);
    await writeFile(allowedFile, safeContent, "utf8");
    const policy = new ProtectedPathPolicy(home);
    let receivedHandle: FileHandle | undefined;

    const result = await policy.readText(allowedFile, (handle: FileHandle) => {
      receivedHandle = handle;
      expect(typeof handle).not.toBe("string");
      return handle.readFile({ encoding: "utf8" });
    });

    expect(result).toBe(safeContent);
    if (receivedHandle === undefined) {
      throw new Error("Expected the descriptor reader to receive a file handle");
    }
    await expect(receivedHandle.stat()).rejects.toMatchObject({ code: "EBADF" });
  });
});
