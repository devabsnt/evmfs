import { ethers } from "ethers";
import { gunzipSync } from "node:zlib";

const STORE_EVENT_TOPIC = ethers.id("Store(bytes32,bytes)");

interface VerifyOptions {
  hash: string;
  rpc: string;
  chainId: string;
  contract?: string;
}

async function fetchLog(
  provider: ethers.JsonRpcProvider,
  contractAddress: string,
  contentHash: string
): Promise<ethers.Log | null> {
  const logs = await provider.getLogs({
    address: contractAddress,
    topics: [STORE_EVENT_TOPIC, contentHash],
    fromBlock: 0,
    toBlock: "latest",
  });

  return logs.length > 0 ? logs[0] : null;
}

export async function verifyCommand(options: VerifyOptions): Promise<void> {
  const provider = new ethers.JsonRpcProvider(options.rpc);
  const contractAddress =
    options.contract ?? "0x0000000000000000000000000000000000000000";

  if (contractAddress === "0x0000000000000000000000000000000000000000") {
    console.error(
      "Error: No contract address specified. Use --contract <address>"
    );
    process.exit(1);
  }

  console.log(`Looking up ${options.hash} on chain ${options.chainId}...`);

  const log = await fetchLog(provider, contractAddress, options.hash);

  if (!log) {
    console.error("No event found for this content hash.");
    process.exit(1);
  }

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const decoded = abiCoder.decode(["bytes"], log.data);
  const rawData = ethers.getBytes(decoded[0]);

  const computedHash = ethers.keccak256(rawData);
  const hashMatch = computedHash === options.hash;

  console.log(`\nBlock: ${log.blockNumber}`);
  console.log(`TX: ${log.transactionHash}`);
  console.log(`Compressed size: ${rawData.length} bytes`);

  try {
    const decompressed = gunzipSync(Buffer.from(rawData));
    console.log(`Decompressed size: ${decompressed.length} bytes`);
  } catch {
    console.log(`Decompressed size: N/A (not gzipped or corrupt)`);
  }

  console.log(`Hash verification: ${hashMatch ? "PASS" : "FAIL"}`);

  if (!hashMatch) {
    console.error(`Expected: ${options.hash}`);
    console.error(`Computed: ${computedHash}`);
    process.exit(1);
  }

  const block = await provider.getBlock(log.blockNumber);
  if (block) {
    console.log(
      `Timestamp: ${new Date(block.timestamp * 1000).toISOString()}`
    );
  }

  const tx = await provider.getTransaction(log.transactionHash);
  if (tx) {
    console.log(`Uploader: ${tx.from}`);
  }
}
