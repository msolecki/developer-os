/**
 * How many guarded reads a vault walk keeps in flight (AUD-025). Each one is a
 * few `realpath` and `stat` calls that wait on the filesystem, not the CPU.
 */
export const VAULT_IO_CONCURRENCY = 16;

/**
 * `items.map(fn)` with at most `limit` calls in flight; the results keep the
 * input order. The first rejection is the result, and no new call starts after it.
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await fn(items[index] as T);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
