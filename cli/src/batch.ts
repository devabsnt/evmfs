export interface FileEntry {
  index: number;
  filename: string;
  compressed: Uint8Array;
}

export interface Batch {
  files: FileEntry[];
  estimatedGas: number;
}

const BASE_TX_GAS = 21_000;
const PER_FILE_OVERHEAD = 1_750;
const PER_BYTE_GAS = 24;
const BATCH_CALL_OVERHEAD = 10_000;

export function estimateFileGas(compressedSize: number): number {
  return compressedSize * PER_BYTE_GAS + PER_FILE_OVERHEAD;
}

export function estimateTotalGas(files: FileEntry[]): number {
  let total = 0;
  for (const f of files) {
    total += estimateFileGas(f.compressed.length);
  }
  return total + BATCH_CALL_OVERHEAD;
}

export function packBatches(files: FileEntry[], gasLimit: number): Batch[] {
  const batches: Batch[] = [];
  let currentBatch: FileEntry[] = [];
  let currentGas = BASE_TX_GAS + BATCH_CALL_OVERHEAD;

  for (const file of files) {
    const fileGas = estimateFileGas(file.compressed.length);

    if (currentBatch.length > 0 && currentGas + fileGas > gasLimit) {
      batches.push({ files: [...currentBatch], estimatedGas: currentGas });
      currentBatch = [];
      currentGas = BASE_TX_GAS + BATCH_CALL_OVERHEAD;
    }

    currentBatch.push(file);
    currentGas += fileGas;
  }

  if (currentBatch.length > 0) {
    batches.push({ files: currentBatch, estimatedGas: currentGas });
  }

  return batches;
}
