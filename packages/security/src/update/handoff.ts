import { decodeCanonicalJson, encodeCanonicalJson, validateOfflineReleaseTrust } from "@developer-os/core";
import type { CanonicalJsonValue, OfflineReleaseTrustV1 } from "@developer-os/core";

import { SecurityRefusalError } from "../paths.js";

const MAXIMUM_TRUST_BYTES = 65_536;
const READ_CHUNK_BYTES = 4096;

/**
 * The launcher-side render step of the FD 3 offline-trust handoff: canonical
 * JSON plus exactly one trailing LF, ready to be written whole to a fresh
 * pipe and the write end closed. Pure and synchronous -- no filesystem or
 * process I/O, so the launcher's actual pipe mechanics stay in
 * `apps/launcher/src/handoff.ts` and this stays independently testable.
 */
export function renderOfflineReleaseTrustPipe(trust: OfflineReleaseTrustV1): Uint8Array {
  const validated = validateOfflineReleaseTrust(trust);
  return new TextEncoder().encode(encodeCanonicalJson(validated as unknown as CanonicalJsonValue));
}

/**
 * The CLI-side read step of the FD 3 offline-trust handoff. Every I/O and
 * identity primitive is injected so the admission logic -- pipe type, size
 * bound, parent identity, exact descriptor set, close-before-context -- is
 * tested without a real OS pipe; `apps/launcher/src/handoff.test.ts` covers
 * the real pipe end to end.
 */
export interface OfflineTrustReaderDependencies {
  /** The real parent process id (`process.ppid`) at read time. */
  readonly parentProcessId: () => number;
  /** Every file descriptor currently open in this process. */
  readonly openDescriptors: () => Promise<readonly number[]>;
  readonly fstat: (descriptor: number) => Promise<{ readonly isFIFO: boolean }>;
  /** One read; an empty result means EOF. */
  readonly read: (descriptor: number, maximumBytes: number) => Promise<Uint8Array>;
  readonly close: (descriptor: number) => Promise<void>;
}

export async function readOfflineReleaseTrustFd(
  descriptor: number,
  dependencies: OfflineTrustReaderDependencies,
): Promise<OfflineReleaseTrustV1> {
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await dependencies.close(descriptor);
  };

  try {
    if (!Number.isInteger(dependencies.parentProcessId()) || dependencies.parentProcessId() <= 1) {
      throw new SecurityRefusalError("Offline release trust handoff has no live launcher parent");
    }

    const openDescriptors = await dependencies.openDescriptors();
    if (!openDescriptors.includes(descriptor)) {
      throw new SecurityRefusalError("Offline release trust handoff descriptor is not open");
    }
    const extra = openDescriptors.filter((candidate) => candidate !== 0 && candidate !== 1 && candidate !== 2 && candidate !== descriptor);
    if (extra.length > 0) {
      throw new SecurityRefusalError("Offline release trust handoff has unexpected inherited descriptors");
    }

    const stat = await dependencies.fstat(descriptor);
    if (!stat.isFIFO) {
      throw new SecurityRefusalError("Offline release trust handoff descriptor is not a pipe");
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const chunk = await dependencies.read(descriptor, READ_CHUNK_BYTES);
      if (chunk.byteLength === 0) break;
      total += chunk.byteLength;
      if (total > MAXIMUM_TRUST_BYTES) {
        throw new SecurityRefusalError("Offline release trust handoff exceeded the 64 KiB bound");
      }
      chunks.push(chunk);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    let value: unknown;
    try {
      value = decodeCanonicalJson(bytes, MAXIMUM_TRUST_BYTES);
    } catch (error) {
      throw new SecurityRefusalError(
        `Offline release trust handoff is not canonical JSON: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    try {
      return validateOfflineReleaseTrust(value);
    } catch (error) {
      throw new SecurityRefusalError(
        `Offline release trust handoff is not a valid trust document: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  } finally {
    await close();
  }
}
