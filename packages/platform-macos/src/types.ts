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
   * that check first.
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
  productStateRoot(userHome: string): string;
  proposedBrainRoot(userHome: string): string;
}
