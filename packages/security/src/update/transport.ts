import { createHash } from "node:crypto";
import { Agent, request as httpsRequest } from "node:https";

import {
  EXIT_CODES,
  encodeCanonicalJson,
  parseLowerHexSha256,
  parseOfficialReleaseRelativePath,
  parseUInt64Decimal,
  validateOfflineReleaseTrust,
  validateReleaseKeyDelegation,
} from "@developer-os/core";
import type {
  CanonicalJsonValue,
  LowerHexSha256,
  OfflineReleaseTrustV1,
  OfficialReleaseOriginV1,
  OfficialReleaseRelativePathV1,
  ReleaseBundleReferenceV1,
  ReleaseKeyDelegationV1,
  UInt64DecimalV1,
} from "@developer-os/core";

import { SecurityRefusalError } from "../paths.js";

/** Spec 2 §4.5: response headers, idle, and the whole top-level network phase. */
const MAXIMUM_HEADER_BYTES = 65_536;
const IDLE_MILLISECONDS = 30_000;
const ATTEMPT_WALL_MILLISECONDS = 900_000;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
/** The closed request header set: no cookie, authorization, referrer, or caller-supplied header. */
const CLOSED_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: "application/octet-stream",
  "accept-encoding": "identity",
  "user-agent": "developer-os-update/1",
});
const MAXIMUM_BODY_BYTES = {
  release_key_delegation: 65_536n,
  release_index: 4_194_304n,
  bundle_manifest: 16_777_216n,
  archive: 2_147_483_648n,
} as const;

export type ReleaseBodySink = (chunk: Uint8Array) => Promise<void>;

/**
 * One bounded GET. Metadata requests name only which launcher-handoff locator
 * to fetch; asset requests name the exact signed bundle reference and the
 * verified delegation whose origins they may reach. No request carries a URL,
 * origin, header, or environment of the caller's choosing. The body streams to
 * `sink` so a 2 GiB archive is never buffered here.
 */
export type ReleaseTransportRequestV1 =
  | { readonly kind: "release_key_delegation" | "release_index"; readonly sink: ReleaseBodySink }
  | {
      readonly kind: "bundle_manifest" | "archive";
      readonly delegation: ReleaseKeyDelegationV1;
      readonly bundle: ReleaseBundleReferenceV1;
      readonly sink: ReleaseBodySink;
    };

export interface BoundedReleaseResponseV1 {
  readonly kind: ReleaseTransportRequestV1["kind"];
  readonly bodyBytes: UInt64DecimalV1;
  readonly bodyHash: LowerHexSha256;
  readonly redirected: boolean;
}

/** What the injected exchange is handed: nothing environment-derived crosses. */
export interface ReleaseExchangeRequestV1 {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly maximumHeaderBytes: number;
  readonly signal: AbortSignal;
  /** Called on DNS, connect, TLS, header, and body progress; re-arms the idle deadline. */
  readonly progress: () => void;
}

export interface ReleaseExchangeResponseV1 {
  readonly status: number;
  /** The URL the response actually answers; must equal the requested URL. */
  readonly effectiveUrl: string;
  /** Node-style alternating name/value list, exactly as received. */
  readonly rawHeaders: readonly string[];
  readonly body: AsyncIterable<Uint8Array>;
}

export interface FixedReleaseTransportDependencies {
  /** The launcher FD 3 handoff, already read by `readOfflineReleaseTrustFd`. */
  readonly trust: OfflineReleaseTrustV1;
  readonly exchange: (request: ReleaseExchangeRequestV1) => Promise<ReleaseExchangeResponseV1>;
  /** Monotonic milliseconds. */
  readonly now: () => number;
  /** Returns a cancel function. */
  readonly setTimer: (callback: () => void, milliseconds: number) => () => void;
}

/** Transport faults that are not policy refusals: deadline, network, or HTTP status. Content-free by construction. */
export class ReleaseTransportError extends Error {
  readonly code = EXIT_CODES.operationalFailure;
  constructor(readonly reason: "timeout" | "network" | "http_status") {
    super(`release_transport_${reason}`);
    this.name = "ReleaseTransportError";
  }
}

function refuse(message: string): never {
  throw new SecurityRefusalError(message);
}

function originKey(origin: OfficialReleaseOriginV1): string {
  return encodeCanonicalJson(origin as unknown as CanonicalJsonValue);
}

/** Appends validated segments to a signed prefix; the result must already be its own WHATWG normal form. */
function buildUrl(origin: OfficialReleaseOriginV1, relativePath: OfficialReleaseRelativePathV1): string {
  const url = `https://${origin.host}${origin.pathPrefix}${relativePath}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    refuse("Release URL is not a valid absolute URL");
  }
  if (parsed.href !== url) refuse("Release URL is not in normal form");
  return url;
}

/**
 * Re-normalizes and rechecks a redirect target before any second request:
 * absolute HTTPS on 443, no userinfo/query/fragment, an exact allowed host and
 * path prefix, a valid relative remainder, and byte equality with the URL
 * rebuilt from those parts. The raw `Location` never reaches a diagnostic.
 */
function admitRedirect(location: string, origins: readonly OfficialReleaseOriginV1[]): string {
  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    refuse("Release redirect target is not an absolute URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    refuse("Release redirect target is not a plain HTTPS URL");
  }
  for (const origin of origins) {
    if (parsed.hostname !== origin.host || !parsed.pathname.startsWith(origin.pathPrefix)) continue;
    let relativePath: OfficialReleaseRelativePathV1;
    try {
      relativePath = parseOfficialReleaseRelativePath(parsed.pathname.slice(origin.pathPrefix.length));
    } catch {
      continue;
    }
    if (buildUrl(origin, relativePath) === location) return location;
  }
  return refuse("Release redirect target is outside the permitted origins");
}

function parseHeaders(rawHeaders: readonly string[]): ReadonlyMap<string, string> {
  if (rawHeaders.length % 2 !== 0) refuse("Release response headers are malformed");
  let bytes = 0;
  const headers = new Map<string, string>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = (rawHeaders[index] as string).toLowerCase();
    const value = rawHeaders[index + 1] as string;
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
    if (bytes > MAXIMUM_HEADER_BYTES) refuse("Release response headers exceed 64 KiB");
    if (headers.has(name) && (name === "location" || name === "content-length" || name === "content-encoding")) {
      refuse("Release response repeats a controlling header");
    }
    headers.set(name, value);
  }
  return headers;
}

/**
 * Spec 2 §4.5's fixed-origin transport. One instance is one top-level
 * planning/apply attempt: the 15-minute wall deadline is fixed at
 * construction and every request, redirect, and descendant draws from it;
 * none can reset it. The exchange is injected, so tests drive a local
 * recording server and production composes `nodeReleaseExchange`.
 */
export class FixedReleaseTransport {
  readonly #trust: OfflineReleaseTrustV1;
  readonly #deadline: number;

  constructor(readonly dependencies: FixedReleaseTransportDependencies) {
    this.#trust = validateOfflineReleaseTrust(dependencies.trust);
    this.#deadline = dependencies.now() + ATTEMPT_WALL_MILLISECONDS;
  }

  /** The shared attempt budget a descendant (verifier, planner) must inherit. */
  remainingMilliseconds(): number {
    return Math.max(0, this.#deadline - this.dependencies.now());
  }

  async get(request: ReleaseTransportRequestV1): Promise<BoundedReleaseResponseV1> {
    let url: string;
    let redirectOrigins: readonly OfficialReleaseOriginV1[];
    let maximumBytes: bigint = MAXIMUM_BODY_BYTES[request.kind];
    let expected: { readonly bytes: bigint; readonly sha256: LowerHexSha256 } | null = null;

    if (!("delegation" in request)) {
      const locator = request.kind === "release_key_delegation" ? this.#trust.delegationLocator : this.#trust.indexLocator;
      url = `${locator.origin}${locator.repositoryPath}${locator.assetName}`;
      redirectOrigins = this.#trust.metadataRedirectOrigins;
    } else {
      const delegation = validateReleaseKeyDelegation(request.delegation);
      const permitted = new Set(this.#trust.metadataRedirectOrigins.map(originKey));
      if (![...delegation.metadataOrigins, ...delegation.assetOrigins].every((origin) => permitted.has(originKey(origin)))) {
        refuse("Delegated release origins are not a subset of the launcher handoff origins");
      }
      const isArchive = request.kind === "archive";
      const path = parseOfficialReleaseRelativePath(isArchive ? request.bundle.archivePath : request.bundle.manifestPath);
      const bytes = BigInt(parseUInt64Decimal(isArchive ? request.bundle.archiveBytes : request.bundle.manifestBytes));
      if (bytes < 1n || bytes > maximumBytes) refuse("Signed release asset size is outside its bound");
      maximumBytes = bytes;
      expected = { bytes, sha256: parseLowerHexSha256(isArchive ? request.bundle.archiveSha256 : request.bundle.manifestSha256) };
      url = buildUrl(delegation.metadataOrigins[0], path);
      redirectOrigins = delegation.assetOrigins;
    }

    let redirected = false;
    for (;;) {
      const outcome = await this.#exchange(url, maximumBytes, expected, request.sink);
      if (outcome.kind === "body") {
        if (expected !== null && outcome.bodyHash !== expected.sha256) refuse("Release asset hash does not match its signed reference");
        return { kind: request.kind, bodyBytes: outcome.bodyBytes, bodyHash: outcome.bodyHash, redirected };
      }
      if (redirected) refuse("Release request attempted a second redirect");
      redirected = true;
      url = admitRedirect(outcome.location, redirectOrigins);
    }
  }

  async #exchange(
    url: string,
    maximumBytes: bigint,
    expected: { readonly bytes: bigint } | null,
    sink: ReleaseBodySink,
  ): Promise<{ readonly kind: "redirect"; readonly location: string } | { readonly kind: "body"; readonly bodyBytes: UInt64DecimalV1; readonly bodyHash: LowerHexSha256 }> {
    const { now, setTimer } = this.dependencies;
    if (this.#deadline - now() <= 0) throw new ReleaseTransportError("timeout");

    const controller = new AbortController();
    let timedOut = false;
    let rejectTimeout: (error: ReleaseTransportError) => void = () => undefined;
    const timeout = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    // Attach a handler so an unraced timeout never surfaces as unhandled.
    timeout.catch(() => undefined);
    let cancelTimer: () => void = () => undefined;
    const arm = (): void => {
      cancelTimer();
      if (timedOut) return;
      cancelTimer = setTimer(
        () => {
          timedOut = true;
          // In-process transport: aborting destroys the socket, which is the whole
          // transport graph. A subprocess exchange must kill and reap its group on this signal.
          controller.abort();
          rejectTimeout(new ReleaseTransportError("timeout"));
        },
        Math.min(IDLE_MILLISECONDS, Math.max(0, this.#deadline - now())),
      );
    };
    const guard = async <T>(promise: Promise<T>): Promise<T> => {
      try {
        return await Promise.race([promise, timeout]);
      } catch (error) {
        if (timedOut) throw new ReleaseTransportError("timeout");
        if (error instanceof SecurityRefusalError || error instanceof ReleaseTransportError) throw error;
        throw new ReleaseTransportError("network");
      }
    };

    arm();
    let iterator: AsyncIterator<Uint8Array> | null = null;
    try {
      const response = await guard(
        this.dependencies.exchange({
          url,
          headers: { ...CLOSED_HEADERS },
          maximumHeaderBytes: MAXIMUM_HEADER_BYTES,
          signal: controller.signal,
          progress: arm,
        }),
      );
      arm();
      iterator = response.body[Symbol.asyncIterator]();
      if (response.effectiveUrl !== url) refuse("Release response effective URL differs from the request");
      const headers = parseHeaders(response.rawHeaders);

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = headers.get("location");
        if (location === undefined) refuse("Release redirect has no target");
        return { kind: "redirect", location };
      }
      if (response.status !== 200) throw new ReleaseTransportError("http_status");

      const encoding = headers.get("content-encoding");
      if (encoding !== undefined && encoding !== "identity") refuse("Release response is content-encoded");
      const lengthText = headers.get("content-length");
      if (lengthText === undefined || !/^(?:0|[1-9][0-9]*)$/.test(lengthText)) refuse("Release response has no exact content length");
      const declared = BigInt(lengthText);
      if (declared > maximumBytes) refuse("Release response declares more than its bound");
      if (expected !== null && declared !== expected.bytes) refuse("Release response length differs from its signed size");

      const hash = createHash("sha256");
      let observed = 0n;
      for (;;) {
        const next = await guard(iterator.next());
        if (next.done === true) break;
        const chunk: unknown = next.value;
        if (!(chunk instanceof Uint8Array)) refuse("Release response body is not bytes");
        observed += BigInt(chunk.byteLength);
        if (observed > declared) refuse("Release response body exceeds its declared length");
        arm();
        hash.update(chunk);
        await guard(sink(chunk));
      }
      if (observed !== declared) refuse("Release response body is truncated");
      return { kind: "body", bodyBytes: observed.toString(10) as UInt64DecimalV1, bodyHash: hash.digest("hex") as LowerHexSha256 };
    } finally {
      cancelTimer();
      if (iterator !== null) void iterator.return?.().catch(() => undefined);
      controller.abort();
    }
  }
}

/**
 * The production exchange: one TLS GET on 443 through a dedicated agent, so
 * no global or environment-configured proxy agent, pooled socket, or ambient
 * credential participates. Node's default certificate verification stays on.
 */
export function nodeReleaseExchange(request: ReleaseExchangeRequestV1): Promise<ReleaseExchangeResponseV1> {
  return new Promise((resolve, reject) => {
    const url = new URL(request.url);
    const outgoing = httpsRequest({
      protocol: "https:",
      hostname: url.hostname,
      servername: url.hostname,
      port: 443,
      path: url.pathname,
      method: "GET",
      headers: request.headers,
      maxHeaderSize: request.maximumHeaderBytes,
      signal: request.signal,
      agent: new Agent({ keepAlive: false }),
    });
    const progress = (): void => {
      request.progress();
    };
    outgoing.on("socket", (socket) => {
      progress();
      socket.on("lookup", progress).on("connect", progress).on("secureConnect", progress);
    });
    outgoing.on("response", (response) => {
      progress();
      // The transport aborts a redirect or refused body mid-stream; that reset is expected.
      response.on("error", () => undefined);
      resolve({ status: response.statusCode ?? 0, effectiveUrl: request.url, rawHeaders: response.rawHeaders, body: response });
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}
