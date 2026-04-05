import { useState, useCallback } from "react";
import {
  type FileEntry,
  type UploadUnit,
  expandFilesToUnits,
  packBatches,
} from "../lib/evmfs";

const GAS_LIMIT = 28_000_000;

export interface ProcessedFiles {
  files: FileEntry[];
  units: UploadUnit[];
  batches: ReturnType<typeof packBatches>;
  totalGas: number;
  totalOriginalSize: number;
  totalCompressedSize: number;
  totalUnits: number;
  chunkedFileCount: number;
}

export function useFileProcessor() {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessedFiles | null>(null);
  const [error, setError] = useState<string | null>(null);

  const processFiles = useCallback(async (inputFiles: File[]) => {
    setProcessing(true);
    setError(null);

    try {
      const sorted = [...inputFiles].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      );

      const entries: FileEntry[] = sorted.map((file, i) => ({
        index: i,
        name: file.name,
        file,
        estimatedCompressedSize: file.size,
      }));

      const totalOriginalSize = entries.reduce((sum, e) => sum + e.file.size, 0);
      const totalCompressedSize = totalOriginalSize;

      const units = expandFilesToUnits(entries);
      const chunkedFileCount = units.filter((u) => u.totalChunks > 1 && u.chunkIndex === 0).length;
      const batches = packBatches(units, GAS_LIMIT);
      const totalGas = batches.reduce((sum, b) => sum + b.estimatedGas, 0) + 200_000;

      setResult({
        files: entries,
        units,
        batches,
        totalGas,
        totalOriginalSize,
        totalCompressedSize,
        totalUnits: units.length,
        chunkedFileCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process files");
    } finally {
      setProcessing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { processing, result, error, processFiles, reset };
}
