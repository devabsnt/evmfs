export interface EVMFSOptions {
  rpc: string;
  contract?: string;
  /**
   * Optional EVMFSBlockIndex contract address. When set, `manifest()` and
   * `fetch()` calls that don't include a block hint will first query the
   * index for `(hash → block)` before falling back to a log scan. Has
   * sensible per-chain defaults; set explicitly only to override.
   */
  blockIndex?: string;
  /**
   * Numeric chain ID (e.g. 1, 11155111, 143). Used to pick the default
   * BlockIndex address if `blockIndex` is not explicitly set. Optional —
   * the lib still works without it, just without index acceleration.
   */
  chainId?: number;
}

export interface ManifestEntry {
  h?: string;
  b?: number;
  p?: { h: string; b: number }[];
  f?: string;
}
