// Helpers for reading EVMFSBlockIndex — the on-chain (hash → block) cache.
// Used by EVMFS.manifest() / EVMFS.fetch() when a block hint isn't supplied,
// to avoid an expensive log scan.

// keccak256("blockOf(bytes32)") first 4 bytes
const BLOCK_OF_SELECTOR = "0x7ee64074";

// Per-chain default BlockIndex contract addresses. Extend as the contract
// is deployed to additional chains.
const DEFAULT_BLOCK_INDEX: Record<number, string> = {
  143: "0x2b62d34557e7cb8cb31dc83d2132396d0ef5cad0", // Monad mainnet
};

export function defaultBlockIndex(chainId: number | undefined): string | undefined {
  if (chainId == null) return undefined;
  return DEFAULT_BLOCK_INDEX[chainId];
}

/**
 * Read the registered block for a manifest hash from a BlockIndex contract.
 * Returns 0 if the hash isn't registered (caller should fall back to a scan).
 * Returns 0 on any RPC / decode error (also fall back).
 */
export async function lookupBlock(
  rpcUrl: string,
  blockIndexAddress: string,
  hash: string
): Promise<number> {
  try {
    const cleanHash = hash.startsWith("0x") ? hash.slice(2) : hash;
    if (cleanHash.length !== 64) return 0;
    const callData = BLOCK_OF_SELECTOR + cleanHash;
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: blockIndexAddress, data: callData }, "latest"],
      }),
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { result?: string; error?: unknown };
    if (!json.result || json.error) return 0;
    const hex = json.result.startsWith("0x") ? json.result.slice(2) : json.result;
    if (hex.length === 0) return 0;
    return parseInt(hex, 16) || 0;
  } catch (_) {
    return 0;
  }
}
