export interface ScannedFile {
  path: string;
  language: string;
  contentHash: string;
  lineCount?: number;
}
