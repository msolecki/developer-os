import { describe, expect, it } from "vitest";

import {
  admitPosixRootOwned,
  admitPosixRootOwnedSync,
  recheckSystemExecutable,
  recheckSystemExecutableSync,
  SystemExecutableRefusalError,
  type SystemExecutableRowV1,
  type SystemPathObservationV1,
} from "./system-executables.js";

const GIT: SystemExecutableRowV1 = { platform: "darwin", id: "git", path: "/usr/bin/git", ancestors: ["/", "/usr", "/usr/bin"] as never, admission: "posix_root_owned", status: "implemented" };
const dir = (mode = 0o755): SystemPathObservationV1 => ({ kind: "directory", ownerUid: 0, mode, dev: "1", ino: "2", size: 64, sha256: null });
type PresentObservation = Exclude<SystemPathObservationV1, { kind: "absent" }>;
const file = (change: Partial<PresentObservation> = {}): PresentObservation =>
  ({ kind: "file", ownerUid: 0, mode: 0o755, dev: "1", ino: "3", size: 101_000, sha256: "a".repeat(64), ...change });
const hostSync = (overrides: Record<string, SystemPathObservationV1> = {}) => {
  const paths: Record<string, SystemPathObservationV1> = { "/": dir(), "/usr": dir(), "/usr/bin": dir(), "/usr/bin/git": file(), ...overrides };
  return (path: string): SystemPathObservationV1 => paths[path] ?? { kind: "absent" as const };
};
const host = (overrides: Record<string, SystemPathObservationV1> = {}) => {
  const inspect = hostSync(overrides);
  return (path: string) => Promise.resolve(inspect(path));
};

describe("posix_root_owned", () => {
  it("admits a root-owned 0755 file under root-owned 0755 ancestors", async () => {
    await expect(admitPosixRootOwned(GIT, host())).resolves.toMatchObject({ canonicalPath: "/usr/bin/git", sha256: "a".repeat(64) });
  });
  it.each([
    ["non-root file", { "/usr/bin/git": file({ ownerUid: 501 }) }],
    ["group-writable file", { "/usr/bin/git": file({ mode: 0o775 }) }],
    ["other-writable file", { "/usr/bin/git": file({ mode: 0o757 }) }],
    ["setuid file", { "/usr/bin/git": file({ mode: 0o4755 }) }],
    ["setgid file", { "/usr/bin/git": file({ mode: 0o2755 }) }],
    ["non-executable file", { "/usr/bin/git": file({ mode: 0o644 }) }],
    ["symlink at the standard path", { "/usr/bin/git": { ...file(), kind: "symlink" } as SystemPathObservationV1 }],
    ["absent file", { "/usr/bin/git": { kind: "absent" } as SystemPathObservationV1 }],
    ["group-writable /usr/bin", { "/usr/bin": dir(0o775) }],
    ["non-root /usr", { "/usr": { ...dir(), ownerUid: 501 } as SystemPathObservationV1 }],
    ["other-writable /", { "/": dir(0o757) }],
  ])("refuses a %s", async (_name, overrides) => {
    await expect(admitPosixRootOwned(GIT, host(overrides))).rejects.toThrow(SystemExecutableRefusalError);
  });
  it("refuses an intended row", async () => {
    await expect(admitPosixRootOwned({ ...GIT, platform: "linux", status: "intended" }, host())).rejects.toThrow(SystemExecutableRefusalError);
  });
  it.each(["dev", "ino", "size", "sha256"] as const)("recheck refuses a changed %s", async (field) => {
    const admitted = await admitPosixRootOwned(GIT, host());
    const drift = file({ [field]: field === "size" ? 1 : field === "sha256" ? "b".repeat(64) : "9" });
    await expect(recheckSystemExecutable(GIT, host({ "/usr/bin/git": drift }), admitted)).rejects.toThrow(SystemExecutableRefusalError);
  });
  it("the synchronous pair applies the same predicate and recheck", async () => {
    expect(admitPosixRootOwnedSync(GIT, hostSync())).toEqual(await admitPosixRootOwned(GIT, host()));
    expect(() => admitPosixRootOwnedSync(GIT, hostSync({ "/usr/bin": dir(0o775) }))).toThrow(SystemExecutableRefusalError);
    const admitted = admitPosixRootOwnedSync(GIT, hostSync());
    expect(() => { recheckSystemExecutableSync(GIT, hostSync(), admitted); }).not.toThrow();
    const drift = hostSync({ "/usr/bin/git": file({ sha256: "b".repeat(64) }) });
    expect(() => { recheckSystemExecutableSync(GIT, drift, admitted); }).toThrow(SystemExecutableRefusalError);
  });
});
