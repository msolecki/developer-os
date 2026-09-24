/**
 * The network-boundary classifier shared by `tests/security/network.test.ts` (over TypeScript
 * sources) and `tests/e2e/foundation.test.ts` (over the compiled `dist` modules), so the two
 * gates cannot drift into two different ideas of what a local-only socket is.
 */

export const networkModule =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:node:)?(?:https?|http2|net|tls|dns|dgram|undici)(?:\/[a-z]+)?["']/u;

/**
 * The Git gateway server's shape: its only value import from a network module is `createServer`
 * from `node:net`, and it names no other network module. A `connect`, an alias import or an
 * `https` import stops it classifying.
 */
export function isLocalSocketServer(source: string): boolean {
  const imports = [...source.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["'];$/gmu)];
  const network = imports.filter((match) => networkModule.test(`from "${match[3] ?? ""}"`));
  const values = network.filter((match) => match[1] === undefined);
  const valueNames = values.map((match) => (match[2] ?? "").trim());
  return network.every((match) => match[3] === "node:net") && valueNames.length === 1 && valueNames[0] === "createServer";
}

/** The Git gateway trampoline template's classification. */
export function isLocalSocketClient(source: string): boolean {
  const references = [...source.matchAll(new RegExp(networkModule.source, "gu"))].map((match) => match[0]);
  const calls = [...source.matchAll(/\bnet\.(\w+)\(([^)]*)\)/gu)].map((match) => `${match[1] ?? ""}(${match[2] ?? ""})`);
  /** `net` the binding, not `node:net` the module: bound once and called once, so no alias exists. */
  const bindings = [...source.matchAll(/(?<!:)\bnet\b/gu)].length;
  return references.length === 1 && references[0] === 'require("node:net"' && bindings === 2 &&
    calls.length === 1 &&
    calls[0] === 'createConnection({ path: process.env.DEVELOPER_OS_GIT_SUPERVISOR_SOCKET ?? \\"\\" })';
}
