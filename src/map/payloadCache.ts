import type { ViewerPayload } from "./renderFeatureMapHtml.ts";

/** Serialized storage gives the cache a byte budget, not just an entry limit.
 * Individual analysis peak memory is separate from this retained-data budget. */
export function createPayloadCache(options: { maxEntries: number; maxBytes: number }) {
  const entries = new Map<string, { json: string; bytes: number }>();
  let totalBytes = 0;
  return {
    get(key: string): ViewerPayload | undefined {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return JSON.parse(entry.json) as ViewerPayload;
    },
    set(key: string, value: ViewerPayload): void {
      const previous = entries.get(key);
      if (previous !== undefined) {
        entries.delete(key);
        totalBytes -= previous.bytes;
      }
      const json = JSON.stringify(value);
      const bytes = Buffer.byteLength(json, "utf8");
      if (bytes > options.maxBytes) return;
      entries.set(key, { json, bytes });
      totalBytes += bytes;
      while (entries.size > options.maxEntries || totalBytes > options.maxBytes) {
        const oldest = entries.entries().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest[0]);
        totalBytes -= oldest[1].bytes;
      }
    },
  };
}
