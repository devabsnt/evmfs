interface UploadProgressProps {
  currentBatch: number;
  totalBatches: number;
  currentTxHash: string | null;
  status: string;
  completedFiles: number;
  totalFiles: number;
  phase: "uploading" | "manifest" | "complete";
  manifestHash?: string;
  baseUri?: string;
  manifestJson?: string;
  chainId: number;
  estimatedGas?: number;
  actualGasUsed?: bigint;
}

export function UploadProgress({
  currentBatch,
  totalBatches,
  currentTxHash,
  status,
  completedFiles,
  totalFiles,
  phase,
  manifestHash,
  baseUri,
  manifestJson,
  chainId,
  estimatedGas,
  actualGasUsed,
}: UploadProgressProps) {
  const overallProgress = phase === "complete"
    ? 100
    : phase === "manifest"
      ? 90 + (10 * completedFiles / Math.max(totalFiles, 1))
      : totalBatches > 0
        ? (currentBatch / totalBatches) * 90
        : 0;

  return (
    <div style={{ padding: "24px 0" }}>
      {phase !== "complete" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "#d1d5db", fontSize: 14 }}>{status}</span>
            <span style={{ color: "#6b7280", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
              {Math.round(overallProgress)}%
            </span>
          </div>

          <div style={{
            height: 6,
            background: "#2a2a3a",
            borderRadius: 3,
            overflow: "hidden",
            marginBottom: 16,
          }}>
            <div
              style={{
                height: "100%",
                width: `${overallProgress}%`,
                background: "linear-gradient(90deg, #5b7def, #8b5cf6)",
                borderRadius: 3,
                transition: "width 0.5s ease",
              }}
            />
          </div>

          {currentTxHash && (
            <div style={{ marginBottom: 12 }}>
              <span style={{ color: "#6b7280", fontSize: 12 }}>Transaction: </span>
              <a
                href={getTxExplorerUrl(chainId, currentTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "#5b7def",
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  textDecoration: "none",
                }}
              >
                {currentTxHash.slice(0, 10)}...{currentTxHash.slice(-8)}
              </a>
            </div>
          )}

          <div style={{ color: "#6b7280", fontSize: 13 }}>
            {completedFiles} / {totalFiles} files uploaded
          </div>
        </>
      )}

      {phase === "complete" && manifestHash && baseUri && (
        <div>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 20,
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span style={{ color: "#22c55e", fontSize: 18, fontWeight: 600 }}>Upload complete</span>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 4 }}>Manifest hash</div>
            <code style={{
              color: "#d1d5db",
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
              background: "#1a1a2e",
              padding: "8px 12px",
              borderRadius: 6,
              display: "block",
              wordBreak: "break-all",
            }}>
              {manifestHash}
            </code>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 4 }}>Base URI</div>
            <code style={{
              color: "#5b7def",
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
              background: "#1a1a2e",
              padding: "8px 12px",
              borderRadius: 6,
              display: "block",
              wordBreak: "break-all",
            }}>
              {baseUri}
            </code>
          </div>

          <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 16 }}>
            <p style={{ margin: "0 0 4px" }}>File 0: {baseUri}0</p>
            <p style={{ margin: "0 0 4px" }}>File 1: {baseUri}1</p>
            <p style={{ margin: 0, color: "#4b5563" }}>...</p>
          </div>

          {estimatedGas && actualGasUsed && (
            <div style={{
              padding: "12px 16px",
              background: "rgba(255, 255, 255, 0.02)",
              borderRadius: 8,
              border: "1px solid #1e1e2e",
              marginBottom: 16,
            }}>
              <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 8 }}>Gas usage</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ color: "#4b5563", fontSize: 11 }}>Estimated</div>
                  <div style={{ color: "#d1d5db", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                    {estimatedGas.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#4b5563", fontSize: 11 }}>Actual</div>
                  <div style={{ color: "#d1d5db", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                    {Number(actualGasUsed).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#4b5563", fontSize: 11 }}>Accuracy</div>
                  <div style={{
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: Math.abs(1 - Number(actualGasUsed) / estimatedGas) < 0.2 ? "#22c55e" : "#eab308",
                  }}>
                    {((Number(actualGasUsed) / estimatedGas) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          )}

          {manifestJson && (
            <button
              onClick={() => {
                const blob = new Blob([manifestJson], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `evmfs-manifest-${manifestHash?.slice(0, 10) ?? "unknown"}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              style={{
                marginTop: 4,
                padding: "10px 20px",
                background: "#1e1e2e",
                color: "#d1d5db",
                border: "1px solid #2a2a3a",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download manifest
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function getTxExplorerUrl(chainId: number, txHash: string): string {
  const explorers: Record<number, string> = {
    1: "https://etherscan.io/tx/",
    11155111: "https://sepolia.etherscan.io/tx/",
  };
  const base = explorers[chainId] || `https://etherscan.io/tx/`;
  return `${base}${txHash}`;
}
