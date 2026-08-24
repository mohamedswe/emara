import type { ParsedSourceFile } from "../parser/types.js";
import type { ScannedFile } from "../scanner/types.js";

/**
 * Source text and frontend output retained in memory for consumers that run
 * immediately after repository indexing. This is deliberately absent from the
 * persisted graph schema.
 */
export interface IndexedSourceFile {
  file: ScannedFile;
  content: string;
  parsed: ParsedSourceFile;
}
