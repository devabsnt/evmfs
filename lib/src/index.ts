import { fetchContent, STORE_EVENT_TOPIC } from "./rpc.js";
import { tryGunzip } from "./decompress.js";
import { verifyHash } from "./keccak256.js";
import { defaultBlockIndex, isV2Contract, lookupBlock } from "./blockIndex.js";
import type { EVMFSOptions, ManifestEntry } from "./types.js";

export type { EVMFSOptions, ManifestEntry };

const DEFAULT_CONTRACT = "0x0000000000000000000000000000000000000000";

export class EVMFS {
  private rpcUrl: string;
  private contract: string;
  private blockIndex?: string;
  private chainId?: number;

  constructor(options: EVMFSOptions) {
    this.rpcUrl = options.rpc;
    this.contract = options.contract ?? DEFAULT_CONTRACT;
    this.chainId = options.chainId;
    this.blockIndex = options.blockIndex ?? defaultBlockIndex(options.chainId);
  }

  /** Resolve a manifest's block. Queries EVMFSV2 directly when configured
   *  for V2 (block stored on the contract itself), else the BlockIndex
   *  sidecar for V1. Returns 0 if unknown - caller falls back to a log scan. */
  async resolveBlock(manifestHash: string): Promise<number> {
    if (isV2Contract(this.contract)) {
      const b = await lookupBlock(this.rpcUrl, this.contract, manifestHash);
      if (b > 0) return b;
    }
    if (!this.blockIndex) return 0;
    return lookupBlock(this.rpcUrl, this.blockIndex, manifestHash);
  }

  /** Fetch and parse the manifest for a given hash. */
  async manifest(manifestHash: string, manifestBlock?: number): Promise<ManifestEntry[]> {
    let block = manifestBlock ?? 0;
    if (!block) block = await this.resolveBlock(manifestHash);
    const raw = await fetchContent(
      this.rpcUrl,
      this.contract,
      STORE_EVENT_TOPIC,
      manifestHash,
      block
    );
    const decompressed = await tryGunzip(raw);
    const text = new TextDecoder().decode(decompressed);
    return JSON.parse(text) as ManifestEntry[];
  }

  /** Fetch a single file by name or numeric index from a manifest. */
  async fetch(manifestHash: string, manifestBlock: number | undefined, path: string): Promise<Uint8Array> {
    const entries = await this.manifest(manifestHash, manifestBlock);
    const entry = this.resolveEntry(entries, path);
    if (!entry) {
      throw new Error(`File not found in manifest: ${path}`);
    }
    return this.fetchEntry(entry);
  }

  /** Fetch all files in a manifest with concurrency control. */
  async fetchAll(
    manifestHash: string,
    manifestBlock: number | undefined,
    options?: {
      concurrency?: number;
      onProgress?: (completed: number, total: number) => void;
    }
  ): Promise<Map<string, Uint8Array>> {
    const entries = await this.manifest(manifestHash, manifestBlock);
    const concurrency = options?.concurrency ?? 5;
    const result = new Map<string, Uint8Array>();
    let completed = 0;

    const work: { key: string; entry: ManifestEntry }[] = entries.map((e, i) => ({
      key: e.f ?? String(i),
      entry: e,
    }));

    const pool: Promise<void>[] = [];
    let idx = 0;

    const runNext = async (): Promise<void> => {
      while (idx < work.length) {
        const item = work[idx++];
        const data = await this.fetchEntry(item.entry);
        result.set(item.key, data);
        completed++;
        options?.onProgress?.(completed, entries.length);
      }
    };

    for (let i = 0; i < Math.min(concurrency, work.length); i++) {
      pool.push(runNext());
    }
    await Promise.all(pool);

    return result;
  }

  private resolveEntry(entries: ManifestEntry[], path: string): ManifestEntry | null {
    const idx = parseInt(path, 10);
    if (!isNaN(idx) && String(idx) === path && idx >= 0 && idx < entries.length) {
      return entries[idx];
    }

    for (const e of entries) {
      if (e.f === path) return e;
    }

    return null;
  }

  private async fetchEntry(entry: ManifestEntry): Promise<Uint8Array> {
    if (entry.p && entry.p.length > 0) {
      const parts = await Promise.all(
        entry.p.map((part) =>
          fetchContent(this.rpcUrl, this.contract, STORE_EVENT_TOPIC, part.h, part.b)
        )
      );
      const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const part of parts) {
        combined.set(part, offset);
        offset += part.length;
      }
      return tryGunzip(combined);
    }

    if (!entry.h) {
      throw new Error("Manifest entry has no hash");
    }
    const raw = await fetchContent(
      this.rpcUrl,
      this.contract,
      STORE_EVENT_TOPIC,
      entry.h,
      entry.b
    );
    const data = await tryGunzip(raw);

    await verifyHash(raw, entry.h);

    return data;
  }
}
