export type AgentName = "claude" | "codex";

export interface PlatformFacts {
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
  readonly release: string;
  readonly userHome: string;
}

export interface AgentDiscovery {
  readonly name: AgentName;
  readonly installed: boolean;
  /**
   * Untrusted: resolved through the caller's PATH, with no assertion about the
   * owner or mode of the containing directory. Anything that executes it owes
   * that check first — **`assertTrustedExecutable` below is that check**, and
   * until 2026-08-17 this sentence described an obligation nothing paid
   * (BACKLOG NEW-15).
   */
  readonly executablePath: string | null;
  /**
   * Always null in Foundation. Version detection belongs to the agent adapters
   * (design spec 6.6) because it requires executing the discovered binary,
   * which the platform boundary deliberately never does.
   */
  readonly version: string | null;
}

export interface PlatformAdapter {
  inspect(): Promise<PlatformFacts>;
  discoverExecutable(name: AgentName): Promise<AgentDiscovery>;
  /**
   * Resolves the path and refuses it if the file the kernel would execute, or any
   * ancestor of it, is writable by somebody other than this user — the obligation
   * `AgentDiscovery.executablePath` states. Throws rather than returning a verdict, so a
   * caller cannot ignore it by forgetting to read a boolean.
   *
   * **It is on the adapter rather than in a helper because that is where the promise is
   * made.** `discoverExecutable` is what hands out an untrusted path; putting the payment
   * beside it means an executor meets both in one interface.
   *
   * **It does not make the obligation unmissable.** Three call sites owed it when it was
   * written and only two were found; the third — `doctor`'s capability probe — was caught
   * by review. There are three today: `ingest`, `capture` and `discoverEachAgent`.
   */
  assertTrustedExecutable(path: string): Promise<void>;
  productStateRoot(userHome: string): string;
  proposedBrainRoot(userHome: string): string;
}
