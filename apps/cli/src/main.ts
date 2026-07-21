export interface CliIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly confirm: (question: string) => Promise<boolean>;
}

export function run(argv: readonly string[], io: CliIo): Promise<number> {
  if (argv.length === 1 && argv[0] === "--version") {
    io.stdout("developer-os 0.0.0");
    return Promise.resolve(0);
  }

  io.stderr("Usage: developer-os --version");
  return Promise.resolve(2);
}
