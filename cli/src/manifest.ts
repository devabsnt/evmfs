import { gzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";

export interface ChunkRef {
  hash: string;
  block: number;
}

export interface ManifestEntry {
  filename: string;
  chunks: ChunkRef[];
}

interface ManifestOutputSingle {
  h: string;
  b: number;
}

interface ManifestOutputMultipart {
  p: { h: string; b: number }[];
}

type ManifestOutputEntry = ManifestOutputSingle | ManifestOutputMultipart;

export function buildManifest(entries: ManifestEntry[]): {
  manifestJson: string;
  manifestGzipped: Uint8Array;
} {
  const output: ManifestOutputEntry[] = entries.map((e) => {
    if (e.chunks.length === 1) {
      return { h: e.chunks[0].hash, b: e.chunks[0].block };
    }
    return {
      p: e.chunks.map((c) => ({ h: c.hash, b: c.block })),
    };
  });
  const manifestJson = JSON.stringify(output);
  const manifestGzipped = gzipSync(Buffer.from(manifestJson));
  return { manifestJson, manifestGzipped: new Uint8Array(manifestGzipped) };
}

export function saveLocalManifest(
  entries: ManifestEntry[],
  outputDir: string
): void {
  const mapping: Record<string, string | { parts: ChunkRef[] }> = {};
  for (const entry of entries) {
    if (entry.chunks.length === 1) {
      mapping[entry.filename] = entry.chunks[0].hash;
    } else {
      mapping[entry.filename] = { parts: entry.chunks };
    }
  }
  const filePath = path.join(outputDir, "manifest.json");
  fs.writeFileSync(filePath, JSON.stringify(mapping, null, 2));
}

export interface ConfirmedChunk {
  fileIndex: number;
  chunkIndex: number;
  totalChunks: number;
  hash: string;
  block: number;
}

export interface UploadState {
  folder: string;
  contractAddress: string;
  chainId: string;
  chunks: ConfirmedChunk[];
  manifestHash?: string;
}

interface LegacyUploadState {
  folder: string;
  contractAddress: string;
  chainId: string;
  uploaded: Record<string, string>;
  manifestHash?: string;
}

export function loadUploadState(folder: string): UploadState | null {
  const statePath = path.join(folder, ".evmfs-upload-state.json");
  if (!fs.existsSync(statePath)) return null;

  const raw = JSON.parse(fs.readFileSync(statePath, "utf-8"));

  if (Array.isArray(raw.chunks)) {
    return raw as UploadState;
  }

  const legacy = raw as LegacyUploadState;
  if (legacy.uploaded) {
    const chunks: ConfirmedChunk[] = Object.entries(legacy.uploaded).map(
      ([idx, hash]) => ({
        fileIndex: parseInt(idx, 10),
        chunkIndex: 0,
        totalChunks: 1,
        hash,
        block: 0,
      })
    );
    return {
      folder: legacy.folder,
      contractAddress: legacy.contractAddress,
      chainId: legacy.chainId,
      chunks,
      manifestHash: legacy.manifestHash,
    };
  }

  return null;
}

export function saveUploadState(folder: string, state: UploadState): void {
  const statePath = path.join(folder, ".evmfs-upload-state.json");
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}
