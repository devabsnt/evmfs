export interface FileEntry {
  index: number;
  filename: string;
  compressed: Uint8Array;
}

export interface UploadUnit {
  fileIndex: number;
  chunkIndex: number;
  totalChunks: number;
  name: string;
  data: Uint8Array;
}

export interface Batch {
  units: UploadUnit[];
  estimatedGas: number;
  byteSize: number;
}

const BASE_TX_GAS = 21_000;
const PER_FILE_OVERHEAD = 1_750;
const PER_BYTE_GAS = 24;
const BATCH_CALL_OVERHEAD = 10_000;
export const MAX_BATCH_BYTES = 100_000;

export function estimateFileGas(compressedSize: number): number {
  return compressedSize * PER_BYTE_GAS + PER_FILE_OVERHEAD;
}

export function expandFilesToUnits(files: FileEntry[]): UploadUnit[] {
  const units: UploadUnit[] = [];
  for (const f of files) {
    if (f.compressed.length <= MAX_BATCH_BYTES) {
      units.push({
        fileIndex: f.index,
        chunkIndex: 0,
        totalChunks: 1,
        name: f.filename,
        data: f.compressed,
      });
    } else {
      const totalChunks = Math.ceil(f.compressed.length / MAX_BATCH_BYTES);
      for (let i = 0; i < totalChunks; i++) {
        const offset = i * MAX_BATCH_BYTES;
        const end = Math.min(offset + MAX_BATCH_BYTES, f.compressed.length);
        units.push({
          fileIndex: f.index,
          chunkIndex: i,
          totalChunks,
          name: `${f.filename}#${i + 1}/${totalChunks}`,
          data: f.compressed.subarray(offset, end),
        });
      }
    }
  }
  return units;
}

export function estimateTotalGas(units: UploadUnit[]): number {
  let total = 0;
  for (const u of units) {
    total += estimateFileGas(u.data.length);
  }
  return total + BATCH_CALL_OVERHEAD;
}

export function packBatches(units: UploadUnit[], gasLimit: number): Batch[] {
  const batches: Batch[] = [];
  let currentUnits: UploadUnit[] = [];
  let currentGas = BASE_TX_GAS + BATCH_CALL_OVERHEAD;
  let currentBytes = 0;

  for (const unit of units) {
    const unitGas = estimateFileGas(unit.data.length);
    const unitBytes = unit.data.length;

    if (
      currentUnits.length > 0 &&
      (currentGas + unitGas > gasLimit || currentBytes + unitBytes > MAX_BATCH_BYTES)
    ) {
      batches.push({
        units: [...currentUnits],
        estimatedGas: currentGas,
        byteSize: currentBytes,
      });
      currentUnits = [];
      currentGas = BASE_TX_GAS + BATCH_CALL_OVERHEAD;
      currentBytes = 0;
    }

    currentUnits.push(unit);
    currentGas += unitGas;
    currentBytes += unitBytes;
  }

  if (currentUnits.length > 0) {
    batches.push({
      units: currentUnits,
      estimatedGas: currentGas,
      byteSize: currentBytes,
    });
  }

  return batches;
}
