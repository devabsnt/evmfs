import { gzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";

export interface ManifestEntry {
  filename: string;
  contentHash: string;
}

export function buildManifest(entries: ManifestEntry[]): {
  manifestJson: string;
  manifestGzipped: Uint8Array;
} {
  const hashArray = entries.map((e) => e.contentHash);
  const manifestJson = JSON.stringify(hashArray);
  const manifestGzipped = gzipSync(Buffer.from(manifestJson));
  return { manifestJson, manifestGzipped: new Uint8Array(manifestGzipped) };
}

export function saveLocalManifest(
  entries: ManifestEntry[],
  outputDir: string
): void {
  const mapping: Record<string, string> = {};
  for (const entry of entries) {
    mapping[entry.filename] = entry.contentHash;
  }
  const filePath = path.join(outputDir, "manifest.json");
  fs.writeFileSync(filePath, JSON.stringify(mapping, null, 2));
}

export interface UploadState {
  folder: string;
  contractAddress: string;
  chainId: string;
  uploaded: Record<number, string>;
  manifestHash?: string;
}

export function loadUploadState(folder: string): UploadState | null {
  const statePath = path.join(folder, ".evmfs-upload-state.json");
  if (fs.existsSync(statePath)) {
    return JSON.parse(fs.readFileSync(statePath, "utf-8"));
  }
  return null;
}

export function saveUploadState(folder: string, state: UploadState): void {
  const statePath = path.join(folder, ".evmfs-upload-state.json");
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}
