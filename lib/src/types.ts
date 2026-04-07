export interface EVMFSOptions {
  rpc: string;
  contract?: string;
}

export interface ManifestEntry {
  h?: string;
  b?: number;
  p?: { h: string; b: number }[];
  f?: string;
}
