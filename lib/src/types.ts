export interface EVMFSOptions {
  rpc: string;
  contract?: string;
  /** Override the per-chain default EVMFSBlockIndex address. */
  blockIndex?: string;
  /** Chain ID used to pick the default BlockIndex address. */
  chainId?: number;
}

export interface ManifestEntry {
  h?: string;
  b?: number;
  p?: { h: string; b: number }[];
  f?: string;
}
