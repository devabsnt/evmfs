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

export interface UploadUnit {
  fileIndex: number;
  chunkIndex: number;
  totalChunks: number;
  name: string;
  byteLength: number;
  file: File;
  byteOffset: number;
}

export interface Batch {
  units: UploadUnit[];
  estimatedGas: number;
  byteSize: number;
}

const BASE_TX_GAS = 21_000;
const PER_FILE_OVERHEAD = 5_000;
const PER_BYTE_GAS = 26;
const BATCH_CALL_OVERHEAD = 10_000;
export const MAX_BATCH_BYTES = 100_000;
const READ_CONCURRENCY = 6;
const RECEIPT_TIMEOUT = 180_000;
const BATCH_RETRIES = 3;
const GAS_MULTIPLIER = 3;

const PROGRESS_KEY = "evmfs_upload_progress";

export interface ConfirmedUnit {
  fileIndex: number;
  chunkIndex: number;
  totalChunks: number;
  hash: string;
  block: number;
}

export interface SavedProgress {
  fileNames: string[];
  chainId: number;
  contractAddress: string;
  confirmed: ConfirmedUnit[];
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
    const p = JSON.parse(raw) as SavedProgress & {
      confirmed: Array<ConfirmedUnit | { index: number; hash: string; block: number }>;
    };
    if (Date.now() - p.savedAt > 24 * 60 * 60 * 1000) {
      clearProgress();
      return null;
    }
    // Migrate legacy format (index-only, no chunking)
    const migrated: ConfirmedUnit[] = p.confirmed.map((c) => {
      if ("fileIndex" in c) return c;
      const legacy = c as { index: number; hash: string; block: number };
      return {
        fileIndex: legacy.index,
        chunkIndex: 0,
        totalChunks: 1,
        hash: legacy.hash,
        block: legacy.block,
      };
    });
    return { ...p, confirmed: migrated };
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

export function expandFilesToUnits(files: FileEntry[]): UploadUnit[] {
  const units: UploadUnit[] = [];
  for (const f of files) {
    const size = f.file.size;
    if (size <= MAX_BATCH_BYTES) {
      units.push({
        fileIndex: f.index,
        chunkIndex: 0,
        totalChunks: 1,
        name: f.name,
        byteLength: size,
        file: f.file,
        byteOffset: 0,
      });
    } else {
      const totalChunks = Math.ceil(size / MAX_BATCH_BYTES);
      for (let i = 0; i < totalChunks; i++) {
        const offset = i * MAX_BATCH_BYTES;
        const end = Math.min(offset + MAX_BATCH_BYTES, size);
        units.push({
          fileIndex: f.index,
          chunkIndex: i,
          totalChunks,
          name: `${f.name}#${i + 1}/${totalChunks}`,
          byteLength: end - offset,
          file: f.file,
          byteOffset: offset,
        });
      }
    }
  }
  return units;
}

export function packBatches(units: UploadUnit[], gasLimit: number): Batch[] {
  const batches: Batch[] = [];
  let currentUnits: UploadUnit[] = [];
  let currentGas = BASE_TX_GAS + BATCH_CALL_OVERHEAD;
  let currentBytes = 0;

  for (const unit of units) {
    const unitGas = estimateFileGas(unit.byteLength);
    const unitBytes = unit.byteLength;

    if (
      currentUnits.length > 0 &&
      (currentGas + unitGas > gasLimit || currentBytes + unitBytes > MAX_BATCH_BYTES)
    ) {
      batches.push({ units: [...currentUnits], estimatedGas: currentGas, byteSize: currentBytes });
      currentUnits = [];
      currentGas = BASE_TX_GAS + BATCH_CALL_OVERHEAD;
      currentBytes = 0;
    }

    currentUnits.push(unit);
    currentGas += unitGas;
    currentBytes += unitBytes;
  }

  if (currentUnits.length > 0) {
    batches.push({ units: currentUnits, estimatedGas: currentGas, byteSize: currentBytes });
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

async function readUnit(unit: UploadUnit): Promise<Uint8Array> {
  const blob = unit.file.slice(unit.byteOffset, unit.byteOffset + unit.byteLength);
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

type ManifestOutputEntry =
  | { h: string; b: number }
  | { p: { h: string; b: number }[] };

export type { ManifestOutputEntry };

export function buildManifestEntries(
  fileCount: number,
  confirmed: ConfirmedUnit[]
): ManifestOutputEntry[] {
  const byFile = new Map<number, ConfirmedUnit[]>();
  for (const c of confirmed) {
    const list = byFile.get(c.fileIndex) ?? [];
    list.push(c);
    byFile.set(c.fileIndex, list);
  }
  const out: ManifestOutputEntry[] = [];
  for (let i = 0; i < fileCount; i++) {
    const chunks = (byFile.get(i) ?? []).slice();
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    if (chunks.length === 0) {
      throw new Error(`missing chunks for file index ${i}`);
    }
    if (chunks.length === 1 && chunks[0].totalChunks === 1) {
      out.push({ h: chunks[0].hash, b: chunks[0].block });
    } else {
      out.push({ p: chunks.map((c) => ({ h: c.hash, b: c.block })) });
    }
  }
  return out;
}

export function getDisplayHash(entry: ManifestOutputEntry): string {
  if ("p" in entry) {
    return entry.p[0]?.h ?? "";
  }
  return entry.h;
}

export interface UploadCallbacks {
  onBatchStart: (batchIndex: number, totalBatches: number, unitCount: number) => void;
  onBatchSent: (batchIndex: number, txHash: string) => void;
  onBatchConfirmed: (batchIndex: number, gasUsed: bigint) => void;
  onFileHashed: (unitName: string, hash: string) => void;
  onManifestUploading: () => void;
  onComplete: (manifestHash: string, baseUri: string, manifestJson: string, totalGasUsed: bigint) => void;
  onError: (error: string) => void;
}

function computeConfirmedKey(u: Pick<ConfirmedUnit, "fileIndex" | "chunkIndex">): string {
  return `${u.fileIndex}:${u.chunkIndex}`;
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
): Promise<{ manifestHash: string; confirmed: ConfirmedUnit[] }> {
  const confirmed = new Map<string, ConfirmedUnit>();
  const account = walletClient.account;
  if (!account) throw new Error("No account connected");
  let totalGasUsed = 0n;

  if (savedProgress) {
    for (const c of savedProgress.confirmed) {
      confirmed.set(computeConfirmedKey(c), c);
    }
    totalGasUsed = BigInt(savedProgress.gasUsed);
    console.log(`[evmfs] resuming: ${savedProgress.confirmed.length} chunks already confirmed`);
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    if (batch.units.every((u) => confirmed.has(computeConfirmedKey(u)))) {
      console.log(`[evmfs] batch ${i + 1}/${batches.length}: skipped (already confirmed)`);
      callbacks.onBatchConfirmed(i, 0n);
      for (const u of batch.units) callbacks.onFileHashed(u.name, confirmed.get(computeConfirmedKey(u))!.hash);
      continue;
    }

    callbacks.onBatchStart(i, batches.length, batch.units.length);

    const batchItems: { hex: Hex; hash: Hex; unit: UploadUnit }[] = [];
    for (let j = 0; j < batch.units.length; j += READ_CONCURRENCY) {
      const chunk = batch.units.slice(j, j + READ_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (u) => {
          const raw = await readUnit(u);
          const hex = toHex(raw);
          const hash = keccak256(hex);
          return { hex, hash, unit: u };
        })
      );
      batchItems.push(...results);
    }

    const hexData = batchItems.map((d) => d.hex);
    const calldataBytes = hexData.reduce((sum, h) => sum + (h.length - 2) / 2, 0);
    const gas = BigInt(Math.ceil(batch.estimatedGas * GAS_MULTIPLIER));

    for (let attempt = 1; attempt <= BATCH_RETRIES; attempt++) {
      try {
        console.log(`[evmfs] batch ${i + 1}/${batches.length}${attempt > 1 ? ` (retry ${attempt}/${BATCH_RETRIES})` : ""}: ${batch.units.length} chunks, ~${(calldataBytes / 1024).toFixed(1)} KB`);

        let txHash: Hex;
        if (batch.units.length === 1) {
          const data = encodeFunctionData({ abi: EVMFS_ABI, functionName: "store", args: [hexData[0]] });
          txHash = await walletClient.sendTransaction({ to: contractAddress, data, gas, account, chain: walletClient.chain });
        } else {
          const data = encodeFunctionData({ abi: EVMFS_ABI, functionName: "storeBatch", args: [hexData] });
          txHash = await walletClient.sendTransaction({ to: contractAddress, data, gas, account, chain: walletClient.chain });
        }

        const hashMap = new Map(batchItems.map((d) => [d.hash, d.unit]));
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
            const unit = hashMap.get(contentHash);
            if (unit) {
              confirmed.set(computeConfirmedKey(unit), {
                fileIndex: unit.fileIndex,
                chunkIndex: unit.chunkIndex,
                totalChunks: unit.totalChunks,
                hash: contentHash,
                block: blockNumber,
              });
              callbacks.onFileHashed(unit.name, contentHash);
            }
          }
        }

        saveProgress({
          fileNames: files.map((f) => f.name),
          chainId,
          contractAddress,
          confirmed: [...confirmed.values()],
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

  const confirmedList = [...confirmed.values()];
  console.log(`[evmfs] uploading manifest for ${files.length} files (${confirmedList.length} chunks)`);

  const manifestEntries = buildManifestEntries(files.length, confirmedList);
  const manifestJson = JSON.stringify(manifestEntries);
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

  return { manifestHash, confirmed: confirmedList };
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
): Promise<{ manifestHash: string; confirmed: ConfirmedUnit[] }> {
  const { ethers } = await import("ethers");

  const contractAbi = [
    "function store(bytes calldata data) external returns (bytes32)",
    "function storeBatch(bytes[] calldata data) external returns (bytes32[])",
    "function storeManifest(bytes calldata data) external returns (bytes32)",
    "event Store(bytes32 indexed contentHash, bytes data)",
  ];

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const confirmed = new Map<string, ConfirmedUnit>();
  let nonce = await provider.getTransactionCount(wallet.address, "pending");
  const rawFeeData = await provider.getFeeData();
  const feeData = {
    maxFeePerGas: (rawFeeData.maxFeePerGas ?? 1_000_000n) * 10n,
    maxPriorityFeePerGas: (rawFeeData.maxPriorityFeePerGas ?? 1_000_000n) * 10n,
  };

  const contract = new ethers.Contract(contractAddress, contractAbi, wallet);
  let totalGasUsed = 0n;

  if (savedProgress) {
    for (const c of savedProgress.confirmed) {
      confirmed.set(computeConfirmedKey(c), c);
    }
    totalGasUsed = BigInt(savedProgress.gasUsed);
    console.log(`[evmfs] resuming: ${savedProgress.confirmed.length} chunks already confirmed`);
  }

  console.log(`[evmfs] sending ${batches.length} batches sequentially via ${rpcUrl.split("/")[2]}, starting nonce: ${nonce}`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    if (batch.units.every((u) => confirmed.has(computeConfirmedKey(u)))) {
      console.log(`[evmfs] batch ${i + 1}/${batches.length}: skipped (already confirmed)`);
      callbacks.onBatchConfirmed(i, 0n);
      for (const u of batch.units) callbacks.onFileHashed(u.name, confirmed.get(computeConfirmedKey(u))!.hash);
      continue;
    }

    callbacks.onBatchStart(i, batches.length, batch.units.length);

    const batchItems: { data: Uint8Array; hash: string; unit: UploadUnit }[] = [];
    for (let j = 0; j < batch.units.length; j += READ_CONCURRENCY) {
      const chunk = batch.units.slice(j, j + READ_CONCURRENCY);
      const items = await Promise.all(
        chunk.map(async (u) => {
          const raw = await readUnit(u);
          const hash = ethers.keccak256(raw);
          return { data: raw, hash, unit: u };
        })
      );
      batchItems.push(...items);
    }

    const fileData = batchItems.map((d) => d.data);
    const calldataBytes = fileData.reduce((sum, d) => sum + d.length, 0);
    const gasLimit = Math.ceil(batch.estimatedGas * GAS_MULTIPLIER);

    for (let attempt = 1; attempt <= BATCH_RETRIES; attempt++) {
      try {
        console.log(`[evmfs] batch ${i + 1}/${batches.length}${attempt > 1 ? ` (retry ${attempt}/${BATCH_RETRIES})` : ""}: ${batch.units.length} chunks, ~${(calldataBytes / 1024).toFixed(1)} KB, nonce: ${nonce}`);

        let tx: Awaited<ReturnType<typeof contract.store>>;
        const overrides = { gasLimit, nonce, maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas };
        if (batch.units.length === 1) {
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

        const hashMap = new Map(batchItems.map((d) => [d.hash, d.unit]));

        for (const log of receipt.logs) {
          const parsed = contract.interface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed && parsed.name === "Store") {
            const contentHash = parsed.args[0] as string;
            const unit = hashMap.get(contentHash);
            if (unit) {
              confirmed.set(computeConfirmedKey(unit), {
                fileIndex: unit.fileIndex,
                chunkIndex: unit.chunkIndex,
                totalChunks: unit.totalChunks,
                hash: contentHash,
                block: blockNumber,
              });
              callbacks.onFileHashed(unit.name, contentHash);
            }
          }
        }

        saveProgress({
          fileNames: files.map((f) => f.name),
          chainId,
          contractAddress,
          confirmed: [...confirmed.values()],
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

  const confirmedList = [...confirmed.values()];
  console.log(`[evmfs] uploading manifest for ${files.length} files (${confirmedList.length} chunks)`);

  const manifestEntries = buildManifestEntries(files.length, confirmedList);
  const manifestJson = JSON.stringify(manifestEntries);
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

  return { manifestHash, confirmed: confirmedList };
}
