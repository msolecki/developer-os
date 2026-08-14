export interface CliIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly confirm: (question: string) => Promise<boolean>;
  /**
   * The observation piped to `developer-os capture` when `--text` is absent,
   * or `null` when **nothing was piped** — which includes an interactive
   * terminal, for the reason `bin.ts`'s `confirm` records right above its own
   * implementation: an unattended run must never be answered by whatever
   * happens to be on stdin, and an interactive `capture` with no `--text` must
   * refuse rather than hang on a terminal that will never send EOF.
   *
   * A channel to the process, so it belongs here beside the other two rather
   * than on `CliContext`, and `bin.ts` is already the only place that binds
   * one. It is read only when `--text` is absent (spec §5.1): a pipe the
   * command never consumes is the honest reading of that sentence.
   */
  readonly readStdin: () => Promise<string | null>;
}
