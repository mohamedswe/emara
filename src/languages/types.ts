import type { ParsedSourceFile } from "../parser/types.js";
import type { ScannedFile } from "../scanner/types.js";
import type { FrameworkRegistry } from "../frameworks/registry.js";

export interface LanguageFrontend {
  id: string;
  supports(file: ScannedFile): boolean;
  parse(
    file: ScannedFile,
    source: string,
    registry: FrameworkRegistry,
  ): ParsedSourceFile;
}
