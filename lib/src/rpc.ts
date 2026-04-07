// keccak256("Store(bytes32,bytes)")
export const STORE_EVENT_TOPIC =
  "0x05b9bfb76702796a34539c7f94a8af4eecb93471e6cdc7f1cb3b1d12ca761660";

const MAX_BLOCK_RANGE = 50_000;

interface JsonRPCResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface LogEntry {
  topics: string[];
  data: string;
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = (await res.json()) as JsonRPCResponse;
  if (json.error) {
    throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
  }
  return json.result;
}

export async function getBlockNumber(rpcUrl: string): Promise<number> {
  const hex = (await rpcCall(rpcUrl, "eth_blockNumber", [])) as string;
  return parseInt(hex, 16);
}

export async function fetchLogsInRange(
  rpcUrl: string,
  contractAddress: string,
  storeEventTopic: string,
  contentHash: string,
  fromBlock: number,
  toBlock: number
): Promise<Uint8Array | null> {
  const filter = {
    fromBlock: "0x" + fromBlock.toString(16),
    toBlock: "0x" + toBlock.toString(16),
    address: contractAddress,
    topics: [storeEventTopic, contentHash],
  };
  const logs = (await rpcCall(rpcUrl, "eth_getLogs", [filter])) as LogEntry[];
  if (!logs || logs.length === 0) return null;
  return abiDecodeBytes(logs[0].data);
}

export function abiDecodeBytes(hexData: string): Uint8Array {
  const hex = hexData.startsWith("0x") ? hexData.slice(2) : hexData;
  const data = hexToBytes(hex);

  if (data.length < 64) {
    throw new Error(`Data too short for ABI decoding: ${data.length} bytes`);
  }

  // First 32 bytes = offset (should be 32)
  const offset = bytesToInt(data.subarray(0, 32));
  if (offset !== 32) {
    throw new Error(`Unexpected ABI offset: ${offset}`);
  }

  // Next 32 bytes = length
  const length = bytesToInt(data.subarray(32, 64));
  if (data.length < 64 + length) {
    throw new Error(`Data truncated: expected ${64 + length} bytes, got ${data.length}`);
  }

  return data.subarray(64, 64 + length);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToInt(bytes: Uint8Array): number {
  let n = 0;
  // Only read last 6 bytes to avoid overflow for reasonable lengths
  const start = Math.max(0, bytes.length - 6);
  for (let i = start; i < bytes.length; i++) {
    n = n * 256 + bytes[i];
  }
  return n;
}

export async function fetchContent(
  rpcUrl: string,
  contractAddress: string,
  storeEventTopic: string,
  contentHash: string,
  blockHint?: number
): Promise<Uint8Array> {
  // Try block hint first
  if (blockHint && blockHint > 0) {
    const from = Math.max(0, blockHint - 1);
    const to = blockHint + 1;
    const data = await fetchLogsInRange(rpcUrl, contractAddress, storeEventTopic, contentHash, from, to);
    if (data) return data;
  }

  // Fall back to scanning from latest block backward
  const latestBlock = await getBlockNumber(rpcUrl);
  let toBlock = latestBlock;

  while (toBlock >= 0) {
    const fromBlock = Math.max(0, toBlock - MAX_BLOCK_RANGE + 1);
    const data = await fetchLogsInRange(rpcUrl, contractAddress, storeEventTopic, contentHash, fromBlock, toBlock);
    if (data) return data;
    if (fromBlock === 0) break;
    toBlock = fromBlock - 1;
  }

  throw new Error(`No logs found for content hash ${contentHash}`);
}
