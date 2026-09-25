export type NormalizedShellCommand =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: "nul" };

export function normalizeShellCommand(command: string): NormalizedShellCommand {
  if (command.includes("\0")) return { ok: false, reason: "nul" };
  const joined = command.replace(/\\(?:\r\n|\n|\r)/gu, "");
  return { ok: true, text: joined.replace(/(?:\r\n|\n|\r)+/gu, "\n") };
}
