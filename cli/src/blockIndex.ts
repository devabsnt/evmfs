// EVMFSBlockIndex sidecar: caches (manifestHash -> block) so consumers can fetch
// by hash without an eth_getLogs scan. Anti-grief: the contract checks
// msg.sender == EVMFS.manifests(hash), so it only succeeds from the same wallet
// that signed storeManifest.

import { ethers } from "ethers";

const DEFAULT_BLOCK_INDEX: Record<string, string> = {
  "1":   "0x85fce8503683a76371568f2f1347cf2c85dddc39", // Ethereum mainnet
  "143": "0x2b62d34557e7cb8cb31dc83d2132396d0ef5cad0", // Monad mainnet
};

// V2 records (uploader, blockNumber) in its own storage, so BlockIndex
// registration is redundant when uploading to V2. Same address on every chain
// via Safe Singleton Factory CREATE2.
export const EVMFS_V2_ADDRESS = "0xb61cdCDC81d97c32122E668AE782b2327d0a623C";

export function isV2Contract(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr.toLowerCase() === EVMFS_V2_ADDRESS.toLowerCase();
}

const BLOCK_INDEX_ABI = [
  "function register(bytes32 hash, uint64 blockNumber) external",
  "function blockOf(bytes32 hash) external view returns (uint64)",
  "event Indexed(bytes32 indexed hash, uint64 blockNumber, address indexed uploader)",
  "error AlreadyIndexed()",
  "error BadBlock()",
  "error UnknownManifest()",
  "error NotManifestUploader()",
];

export function getBlockIndexAddress(chainId: string, override?: string): string | undefined {
  if (override && override !== "") return override;
  return DEFAULT_BLOCK_INDEX[chainId];
}

/** Register a manifest hash in BlockIndex. Soft-fails: upload already succeeded. */
export async function registerInBlockIndex(opts: {
  wallet: ethers.Wallet;
  chainId: string;
  manifestHash: string;
  blockNumber: number;
  contractOverride?: string;
}): Promise<void> {
  const addr = getBlockIndexAddress(opts.chainId, opts.contractOverride);
  if (!addr) {
    console.log(
      `  Block index: no contract configured for chain ${opts.chainId} (skipping; you can register manually later)`
    );
    return;
  }

  const contract = new ethers.Contract(addr, BLOCK_INDEX_ABI, opts.wallet);

  try {
    const tx = await contract.register(opts.manifestHash, BigInt(opts.blockNumber));
    console.log(`  Block index TX: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt) {
      console.log(
        `  Block index: registered ${opts.manifestHash.slice(0, 10)}… → block ${opts.blockNumber}`
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("AlreadyIndexed")) {
      console.log(`  Block index: already registered (no-op)`);
    } else if (msg.includes("NotManifestUploader")) {
      console.log(
        `  Block index: skipped — caller is not the recorded manifest uploader`
      );
    } else if (msg.includes("UnknownManifest")) {
      console.log(
        `  Block index: skipped — manifest not found in EVMFS.manifests mapping`
      );
    } else {
      console.log(`  Block index: skipped (${msg.split("\n")[0]})`);
    }
  }
}
