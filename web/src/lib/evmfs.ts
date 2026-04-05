import { type WalletClient, type PublicClient, encodeFunctionData, keccak256, bytesToHex, type Hex } from "viem";

const EVMFS_ABI = [
  {
    type: "function",
    name: "store",
    inputs: [{ name: "data", type: "bytes" }],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "storeBatch",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "", type: "bytes32[]" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "storeManifest",
    inputs: [{ name: "data", type: "bytes" }],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Store",
    inputs: [
      { name: "contentHash", type: "bytes32", indexed: true },
      { name: "data", type: "bytes", indexed: false },
    ],
  },
] as const;

export { EVMFS_ABI };

export interface FileEntry {
  index: number;
  name: string;
  file: File;
  estimatedCompressedSize: number;
}

export interface Batch {
  files: FileEntry[];
  estimatedGas: number;
}

const BASE_TX_GAS = 21_000;
const PER_FILE_OVERHEAD = 5_000;
const PER_BYTE_GAS = 26;
const BATCH_CALL_OVERHEAD = 10_000;
const MAX_BATCH_BYTES = 100_000;
const READ_CONCURRENCY = 6;
const RECEIPT_TIMEOUT = 180_000;
const BATCH_RETRIES = 3;
const GAS_MULTIPLIER = 3;

const PROGRESS_KEY = "evmfs_upload_progress";

export interface SavedProgress {
  fileNames: string[];
  chainId: number;
  contractAddress: string;
  confirmed: { index: number; hash: string; block: number }[];
  gasUsed: string;
  savedAt: number;
}

export function saveProgress(progress: SavedProgress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch { void 0; }
}

export function loadProgress(): SavedProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SavedProgress;
    if (Date.now() - p.savedAt > 24 * 60 * 60 * 1000) {
      clearProgress();
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export function clearProgress(): void {
  try { localStorage.removeItem(PROGRESS_KEY); } catch { /* empty */ }
}

export function progressMatchesFiles(progress: SavedProgress, files: FileEntry[], chainId: number, contractAddress: string): boolean {
  if (progress.chainId !== chainId) return false;
  if (progress.contractAddress.toLowerCase() !== contractAddress.toLowerCase()) return false;
  if (progress.fileNames.length !== files.length) return false;
  return progress.fileNames.every((name, i) => name === files[i].name);
}

function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const stripped = raw.replace(/0x[0-9a-fA-F]{200,}/g, "0x…<calldata>");
  return stripped.length > 1000 ? stripped.slice(0, 1000) + "…" : stripped;
}

export function estimateFileGas(fileSize: number): number {
  return fileSize * PER_BYTE_GAS + PER_FILE_OVERHEAD;
}

export function packBatches(files: FileEntry[], gasLimit: number): Batch[] {
  const batches: Batch[] = [];
  let currentBatch: FileEntry[] = [];
  let currentGas = BASE_TX_GAS + BATCH_CALL_OVERHEAD;
  let currentBytes = 0;

  for (const file of files) {
    const fileGas = estimateFileGas(file.estimatedCompressedSize);
    const fileBytes = file.estimatedCompressedSize;

    if (
      currentBatch.length > 0 &&
      (currentGas + fileGas > gasLimit || currentBytes + fileBytes > MAX_BATCH_BYTES)
    ) {
      batches.push({ files: [...currentBatch], estimatedGas: currentGas });
      currentBatch = [];
      currentGas = BASE_TX_GAS + BATCH_CALL_OVERHEAD;
      currentBytes = 0;
    }

    currentBatch.push(file);
    currentGas += fileGas;
    currentBytes += fileBytes;
  }

  if (currentBatch.length > 0) {
    batches.push({ files: currentBatch, estimatedGas: currentGas });
  }

  return batches;
}

export function toHex(data: Uint8Array): Hex {
  return bytesToHex(data);
}

async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(data as unknown as BufferSource);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let len = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    len += value.length;
  }
  const result = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) { result.set(c, off); off += c.length; }
  return result;
}

async function readFile(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

export interface ManifestEntry {
  h: string;
  b: number;
}

export function buildManifestJson(entries: ManifestEntry[]): string {
  return JSON.stringify(entries);
}

export interface UploadCallbacks {
  onBatchStart: (batchIndex: number, totalBatches: number, fileCount: number) => void;
  onBatchSent: (batchIndex: number, txHash: string) => void;
  onBatchConfirmed: (batchIndex: number, gasUsed: bigint) => void;
  onFileHashed: (fileName: string, hash: string) => void;
  onManifestUploading: () => void;
  onComplete: (manifestHash: string, baseUri: string, manifestJson: string, totalGasUsed: bigint) => void;
  onError: (error: string) => void;
}

export async function uploadFiles(
  files: FileEntry[],
  batches: Batch[],
  contractAddress: Hex,
  walletClient: WalletClient,
  publicClient: PublicClient,
  chainId: number,
  gatewayUrl: string,
  callbacks: UploadCallbacks,
  savedProgress?: SavedProgress | null
): Promise<{ manifestHash: string; fileHashes: Map<number, string> }> {
  const fileHashes = new Map<number, string>();
  const fileBlocks = new Map<number, number>();
  const account = walletClient.account;
  if (!account) throw new Error("No account connected");
  let totalGasUsed = 0n;

  const completedFileIndices = new Set<number>();
  if (savedProgress) {
    for (const c of savedProgress.confirmed) {
      fileHashes.set(c.index, c.hash);
      fileBlocks.set(c.index, c.block);
      completedFileIndices.add(c.index);
    }
    totalGasUsed = BigInt(savedProgress.gasUsed);
    console.log(`[evmfs] resuming: ${savedProgress.confirmed.length} files already confirmed`);
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    if (batch.files.every((f) => completedFileIndices.has(f.index))) {
      console.log(`[evmfs] batch ${i + 1}/${batches.length}: skipped (already confirmed)`);
      callbacks.onBatchConfirmed(i, 0n);
      for (const f of batch.files) callbacks.onFileHashed(f.name, fileHashes.get(f.index)!);
      continue;
    }

    callbacks.onBatchStart(i, batches.length, batch.files.length);

    const batchItems: { hex: Hex; hash: Hex; fileEntry: FileEntry }[] = [];
    for (let j = 0; j < batch.files.length; j += READ_CONCURRENCY) {
      const chunk = batch.files.slice(j, j + READ_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (f) => {
          const raw = await readFile(f.file);
          const hex = toHex(raw);
          const hash = keccak256(hex);
          return { hex, hash, fileEntry: f };
        })
      );
      batchItems.push(...results);
    }

    const hexData = batchItems.map((d) => d.hex);
    const calldataBytes = hexData.reduce((sum, h) => sum + (h.length - 2) / 2, 0);
    const gas = BigInt(Math.ceil(batch.estimatedGas * GAS_MULTIPLIER));

    for (let attempt = 1; attempt <= BATCH_RETRIES; attempt++) {
      try {
        console.log(`[evmfs] batch ${i + 1}/${batches.length}${attempt > 1 ? ` (retry ${attempt}/${BATCH_RETRIES})` : ""}: ${batch.files.length} files, ~${(calldataBytes / 1024).toFixed(1)} KB`);

        let txHash: Hex;
        if (batch.files.length === 1) {
          const data = encodeFunctionData({ abi: EVMFS_ABI, functionName: "store", args: [hexData[0]] });
          txHash = await walletClient.sendTransaction({ to: contractAddress, data, gas, account, chain: walletClient.chain });
        } else {
          const data = encodeFunctionData({ abi: EVMFS_ABI, functionName: "storeBatch", args: [hexData] });
          txHash = await walletClient.sendTransaction({ to: contractAddress, data, gas, account, chain: walletClient.chain });
        }

        const hashMap = new Map(batchItems.map((d) => [d.hash, d.fileEntry]));
        callbacks.onBatchSent(i, txHash);

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: RECEIPT_TIMEOUT });

        if (receipt.status === "reverted") {
          throw new Error(`Batch ${i + 1} reverted on-chain (tx: ${txHash}). Gas used: ${receipt.gasUsed}`);
        }

        const blockNumber = Number(receipt.blockNumber);
        totalGasUsed += receipt.gasUsed;
        console.log(`[evmfs] batch ${i + 1} confirmed, block: ${blockNumber}, gasUsed: ${receipt.gasUsed}`);
        callbacks.onBatchConfirmed(i, receipt.gasUsed);

        for (const log of receipt.logs) {
          if (log.address.toLowerCase() === contractAddress.toLowerCase() && log.topics[1]) {
            const contentHash = log.topics[1];
            const entry = hashMap.get(contentHash);
            if (entry) {
              fileHashes.set(entry.index, contentHash);
              fileBlocks.set(entry.index, blockNumber);
              callbacks.onFileHashed(entry.name, contentHash);
            }
          }
        }

        saveProgress({
          fileNames: files.map((f) => f.name),
          chainId,
          contractAddress,
          confirmed: [...fileHashes.entries()].map(([idx, hash]) => ({ index: idx, hash, block: fileBlocks.get(idx)! })),
          gasUsed: totalGasUsed.toString(),
          savedAt: Date.now(),
        });

        break;
      } catch (err) {
        console.error(`[evmfs] batch ${i + 1} attempt ${attempt} failed:`, err);
        if (attempt === BATCH_RETRIES) {
          throw new Error(`Batch ${i + 1} failed after ${BATCH_RETRIES} attempts: ${sanitizeError(err)}`);
        }
        console.log(`[evmfs] retrying batch ${i + 1}...`);
      }
    }

    batchItems.length = 0;
  }

  callbacks.onManifestUploading();

  const missingIndices = files.filter((_, idx) => !fileHashes.has(idx)).map((_, idx) => idx);
  if (missingIndices.length > 0) {
    console.error(`[evmfs] missing hashes for ${missingIndices.length} files (indices: ${missingIndices.slice(0, 20).join(", ")}${missingIndices.length > 20 ? "…" : ""})`);
  }
  console.log(`[evmfs] uploading manifest for ${files.length} files (${fileHashes.size} hashes collected)`);

  const manifestEntries: ManifestEntry[] = files.map((_, idx) => ({
    h: fileHashes.get(idx)!,
    b: fileBlocks.get(idx)!,
  }));
  const manifestJson = buildManifestJson(manifestEntries);
  const manifestRaw = new TextEncoder().encode(manifestJson);
  const manifestBytes = await gzipCompress(manifestRaw);
  console.log(`[evmfs] manifest: ${manifestRaw.length} bytes → ${manifestBytes.length} bytes gzipped`);
  const manifestHex = toHex(manifestBytes);

  const manifestTxData = encodeFunctionData({ abi: EVMFS_ABI, functionName: "storeManifest", args: [manifestHex] });
  const manifestGas = BigInt(Math.ceil((manifestBytes.length * PER_BYTE_GAS + PER_FILE_OVERHEAD + BASE_TX_GAS) * GAS_MULTIPLIER));
  const manifestTxHash = await walletClient.sendTransaction({
    to: contractAddress, data: manifestTxData, gas: manifestGas, account, chain: walletClient.chain,
  });

  const manifestReceipt = await publicClient.waitForTransactionReceipt({ hash: manifestTxHash, timeout: RECEIPT_TIMEOUT });

  if (manifestReceipt.status === "reverted") {
    console.error(`[evmfs] manifest tx reverted! tx: ${manifestTxHash}`);
    throw new Error(`Manifest transaction reverted (tx: ${manifestTxHash})`);
  }

  totalGasUsed += manifestReceipt.gasUsed;
  const manifestBlock = Number(manifestReceipt.blockNumber);

  let manifestHash = "";
  for (const log of manifestReceipt.logs) {
    if (log.address.toLowerCase() === contractAddress.toLowerCase() && log.topics[1]) {
      manifestHash = log.topics[1];
    }
  }

  clearProgress();
  console.log(`[evmfs] upload complete! manifest: ${manifestHash}, block: ${manifestBlock}`);
  const baseUri = `${gatewayUrl}/${chainId}/${manifestBlock}/${manifestHash}/`;
  callbacks.onComplete(manifestHash, baseUri, manifestJson, totalGasUsed);

  return { manifestHash, fileHashes };
}

export async function uploadFilesWithPrivateKey(
  files: FileEntry[],
  batches: Batch[],
  contractAddress: Hex,
  privateKey: Hex,
  rpcUrl: string,
  chainId: number,
  gatewayUrl: string,
  callbacks: UploadCallbacks,
  savedProgress?: SavedProgress | null
): Promise<{ manifestHash: string; fileHashes: Map<number, string> }> {
  const { ethers } = await import("ethers");

  const contractAbi = [
    "function store(bytes calldata data) external returns (bytes32)",
    "function storeBatch(bytes[] calldata data) external returns (bytes32[])",
    "function storeManifest(bytes calldata data) external returns (bytes32)",
    "event Store(bytes32 indexed contentHash, bytes data)",
  ];

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const fileHashes = new Map<number, string>();
  const fileBlocks = new Map<number, number>();
  let nonce = await provider.getTransactionCount(wallet.address, "pending");
  const rawFeeData = await provider.getFeeData();
  const feeData = {
    maxFeePerGas: (rawFeeData.maxFeePerGas ?? 1_000_000n) * 10n,
    maxPriorityFeePerGas: (rawFeeData.maxPriorityFeePerGas ?? 1_000_000n) * 10n,
  };

  const contract = new ethers.Contract(contractAddress, contractAbi, wallet);
  let totalGasUsed = 0n;

  const completedFileIndices = new Set<number>();
  if (savedProgress) {
    for (const c of savedProgress.confirmed) {
      fileHashes.set(c.index, c.hash);
      fileBlocks.set(c.index, c.block);
      completedFileIndices.add(c.index);
    }
    totalGasUsed = BigInt(savedProgress.gasUsed);
    console.log(`[evmfs] resuming: ${savedProgress.confirmed.length} files already confirmed`);
  }

  console.log(`[evmfs] sending ${batches.length} batches sequentially via ${rpcUrl.split("/")[2]}, starting nonce: ${nonce}`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    if (batch.files.every((f) => completedFileIndices.has(f.index))) {
      console.log(`[evmfs] batch ${i + 1}/${batches.length}: skipped (already confirmed)`);
      callbacks.onBatchConfirmed(i, 0n);
      for (const f of batch.files) callbacks.onFileHashed(f.name, fileHashes.get(f.index)!);
      continue;
    }

    callbacks.onBatchStart(i, batches.length, batch.files.length);

    const batchItems: { data: Uint8Array; hash: string; fileEntry: FileEntry }[] = [];
    for (let j = 0; j < batch.files.length; j += READ_CONCURRENCY) {
      const chunk = batch.files.slice(j, j + READ_CONCURRENCY);
      const items = await Promise.all(
        chunk.map(async (f) => {
          const raw = await readFile(f.file);
          const hash = ethers.keccak256(raw);
          return { data: raw, hash, fileEntry: f };
        })
      );
      batchItems.push(...items);
    }

    const fileData = batchItems.map((d) => d.data);
    const calldataBytes = fileData.reduce((sum, d) => sum + d.length, 0);
    const gasLimit = Math.ceil(batch.estimatedGas * GAS_MULTIPLIER);

    for (let attempt = 1; attempt <= BATCH_RETRIES; attempt++) {
      try {
        console.log(`[evmfs] batch ${i + 1}/${batches.length}${attempt > 1 ? ` (retry ${attempt}/${BATCH_RETRIES})` : ""}: ${batch.files.length} files, ~${(calldataBytes / 1024).toFixed(1)} KB, nonce: ${nonce}`);

        let tx: Awaited<ReturnType<typeof contract.store>>;
        const overrides = { gasLimit, nonce, maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas };
        if (batch.files.length === 1) {
          tx = await contract.store(fileData[0], overrides);
        } else {
          tx = await contract.storeBatch(fileData, overrides);
        }

        console.log(`[evmfs] batch ${i + 1} sent: ${tx.hash}`);
        callbacks.onBatchSent(i, tx.hash);

        const receipt = await tx.wait(1, RECEIPT_TIMEOUT);
        if (!receipt) throw new Error(`Batch ${i + 1} transaction failed`);

        if (receipt.status === 0) {
          throw new Error(`Batch ${i + 1} reverted on-chain (tx: ${tx.hash}). Gas used: ${receipt.gasUsed}`);
        }

        nonce++;
        const blockNumber = receipt.blockNumber;
        totalGasUsed += BigInt(receipt.gasUsed.toString());
        console.log(`[evmfs] batch ${i + 1} confirmed, block: ${blockNumber}, gasUsed: ${receipt.gasUsed}`);
        callbacks.onBatchConfirmed(i, BigInt(receipt.gasUsed.toString()));

        const hashMap = new Map(batchItems.map((d) => [d.hash, d.fileEntry]));

        for (const log of receipt.logs) {
          const parsed = contract.interface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed && parsed.name === "Store") {
            const contentHash = parsed.args[0] as string;
            const entry = hashMap.get(contentHash);
            if (entry) {
              fileHashes.set(entry.index, contentHash);
              fileBlocks.set(entry.index, blockNumber);
              callbacks.onFileHashed(entry.name, contentHash);
            }
          }
        }

        saveProgress({
          fileNames: files.map((f) => f.name),
          chainId,
          contractAddress,
          confirmed: [...fileHashes.entries()].map(([idx, hash]) => ({ index: idx, hash, block: fileBlocks.get(idx)! })),
          gasUsed: totalGasUsed.toString(),
          savedAt: Date.now(),
        });

        break;
      } catch (err) {
        console.error(`[evmfs] batch ${i + 1} attempt ${attempt} failed:`, err);
        if (attempt === BATCH_RETRIES) {
          throw new Error(`Batch ${i + 1} failed after ${BATCH_RETRIES} attempts: ${sanitizeError(err)}`);
        }
        nonce = await provider.getTransactionCount(wallet.address, "pending");
        console.log(`[evmfs] retrying batch ${i + 1}, nonce reset to ${nonce}...`);
      }
    }

    batchItems.length = 0;
  }

  callbacks.onManifestUploading();

  const missingIndices = files.filter((_, idx) => !fileHashes.has(idx)).map((_, idx) => idx);
  if (missingIndices.length > 0) {
    console.error(`[evmfs] missing hashes for ${missingIndices.length} files (indices: ${missingIndices.slice(0, 20).join(", ")}${missingIndices.length > 20 ? "…" : ""})`);
  }
  console.log(`[evmfs] uploading manifest for ${files.length} files (${fileHashes.size} hashes collected)`);

  const manifestEntries: ManifestEntry[] = files.map((_, idx) => ({
    h: fileHashes.get(idx)!,
    b: fileBlocks.get(idx)!,
  }));
  const manifestJson = buildManifestJson(manifestEntries);
  const manifestRaw = new TextEncoder().encode(manifestJson);
  const manifestBytes = await gzipCompress(manifestRaw);
  console.log(`[evmfs] manifest: ${manifestRaw.length} bytes → ${manifestBytes.length} bytes gzipped`);

  const manifestGasLimit = Math.ceil((manifestBytes.length * PER_BYTE_GAS + PER_FILE_OVERHEAD + BASE_TX_GAS) * GAS_MULTIPLIER);
  const manifestTx = await contract.storeManifest(manifestBytes, {
    gasLimit: manifestGasLimit, nonce, maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  });
  const manifestReceipt = await manifestTx.wait(1, RECEIPT_TIMEOUT);
  if (!manifestReceipt) throw new Error("Manifest transaction failed");

  if (manifestReceipt.status === 0) {
    console.error(`[evmfs] manifest tx reverted! tx: ${manifestTx.hash}`);
    throw new Error(`Manifest transaction reverted (tx: ${manifestTx.hash})`);
  }

  totalGasUsed += BigInt(manifestReceipt.gasUsed.toString());
  const manifestBlock = manifestReceipt.blockNumber;

  let manifestHash = "";
  for (const log of manifestReceipt.logs) {
    const parsed = contract.interface.parseLog({ topics: log.topics as string[], data: log.data });
    if (parsed && parsed.name === "Store") {
      manifestHash = parsed.args[0] as string;
    }
  }

  clearProgress();
  console.log(`[evmfs] upload complete! manifest: ${manifestHash}, block: ${manifestBlock}`);
  const baseUri = `${gatewayUrl}/${chainId}/${manifestBlock}/${manifestHash}/`;
  callbacks.onComplete(manifestHash, baseUri, manifestJson, totalGasUsed);

  return { manifestHash, fileHashes };
}
