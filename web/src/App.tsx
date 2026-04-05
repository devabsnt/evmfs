import { useState, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useWalletClient, usePublicClient, useChainId } from "wagmi";
import { type Hex } from "viem";
import { FileDropzone } from "./components/FileDropzone";
import { CostEstimate } from "./components/CostEstimate";
import { UploadProgress } from "./components/UploadProgress";
import { PrivateKeyInput } from "./components/PrivateKeyInput";
import { UploadHistory } from "./components/UploadHistory";
import { Docs } from "./components/Docs";
import { useFileProcessor } from "./hooks/useFileProcessor";
import { useUploadHistory } from "./hooks/useUploadHistory";
import { uploadFiles, uploadFilesWithPrivateKey, type UploadCallbacks, loadProgress, clearProgress, progressMatchesFiles, type SavedProgress, type ManifestOutputEntry, getDisplayHash } from "./lib/evmfs";
import { calculateFee, FEE_RECIPIENT } from "./lib/fee";
import { EVMFS_CONTRACT, DEFAULT_RPC_URLS } from "./lib/wagmi";
import type { SavedUpload } from "./lib/history";

type UploadMode = "wallet" | "privatekey";
type Tab = "upload" | "history" | "docs";

interface UploadUIState {
  phase: "idle" | "uploading" | "manifest" | "complete" | "error";
  currentBatch: number;
  totalBatches: number;
  currentTxHash: string | null;
  status: string;
  completedFiles: number;
  totalFiles: number;
  manifestHash?: string;
  baseUri?: string;
  manifestJson?: string;
  totalGasUsed?: bigint;
  error?: string;
}

const GATEWAY_URL = typeof window !== "undefined" ? window.location.origin : "";

export default function App() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { processing, result, processFiles, reset } = useFileProcessor();

  const [tab, setTab] = useState<Tab>("upload");
  const [uploadMode, setUploadMode] = useState<UploadMode>("wallet");
  const [pkConfig, setPkConfig] = useState<{ privateKey: string } | null>(null);
  const [customRpcUrl, setCustomRpcUrl] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const history = useUploadHistory();

  const [uploadState, setUploadState] = useState<UploadUIState>({
    phase: "idle",
    currentBatch: 0,
    totalBatches: 0,
    currentTxHash: null,
    status: "",
    completedFiles: 0,
    totalFiles: 0,
  });

  const handleFiles = useCallback(
    (files: File[]) => {
      reset();
      processFiles(files);
    },
    [processFiles, reset]
  );

  const createCallbacks = useCallback(
    (): UploadCallbacks => ({
      onBatchStart: (batchIndex, totalBatches, fileCount) => {
        setUploadState((s) => ({
          ...s,
          phase: "uploading",
          currentBatch: batchIndex + 1,
          totalBatches,
          status: `Uploading batch ${batchIndex + 1} of ${totalBatches} (${fileCount} files)...`,
          currentTxHash: null,
        }));
      },
      onBatchSent: (_batchIndex, txHash) => {
        setUploadState((s) => ({
          ...s,
          currentTxHash: txHash,
          status: `Waiting for confirmation...`,
        }));
      },
      onBatchConfirmed: () => {},
      onFileHashed: () => {
        setUploadState((s) => ({
          ...s,
          completedFiles: s.completedFiles + 1,
        }));
      },
      onManifestUploading: () => {
        setUploadState((s) => ({
          ...s,
          phase: "manifest",
          status: "Uploading manifest...",
          currentTxHash: null,
        }));
      },
      onComplete: (manifestHash, baseUri, manifestJson, totalGasUsed) => {
        setUploadState((s) => ({
          ...s,
          phase: "complete",
          manifestHash,
          baseUri,
          manifestJson,
          totalGasUsed,
          status: "Complete!",
        }));

        if (result) {
          const manifestEntries: ManifestOutputEntry[] = JSON.parse(manifestJson);
          const savedUpload: SavedUpload = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            chainId,
            manifestHash,
            baseUri,
            totalGasUsed: totalGasUsed.toString(),
            fileCount: result.files.length,
            files: result.files.map((f, i) => ({
              index: f.index,
              filename: f.name,
              contentHash: manifestEntries[i] ? getDisplayHash(manifestEntries[i]) : "",
            })),
            label: `Upload ${new Date().toLocaleDateString()}`,
          };
          history.save(savedUpload);
        }
      },
      onError: (error) => {
        setUploadState((s) => ({
          ...s,
          phase: "error",
          error,
          status: `Error: ${error}`,
        }));
      },
    }),
    [result, chainId, history]
  );

  const startUpload = useCallback(async (resumeProgress?: SavedProgress | null) => {
    if (!result) return;

    const addr = EVMFS_CONTRACT;
    const isResume = !!resumeProgress;

    setUploadState({
      phase: "uploading",
      currentBatch: 0,
      totalBatches: result.batches.length,
      currentTxHash: null,
      status: isResume ? "Resuming upload..." : "Sending protocol fee...",
      completedFiles: isResume ? resumeProgress!.confirmed.length : 0,
      totalFiles: result.totalUnits,
    });

    const callbacks = createCallbacks();
    const fee = calculateFee(result.totalOriginalSize);

    const rpcUrl = customRpcUrl || DEFAULT_RPC_URLS[chainId] || "";

    try {
      if (!isResume && fee > 0n) {
        if (uploadMode === "privatekey" && pkConfig) {
          const { ethers } = await import("ethers");
          const provider = new ethers.JsonRpcProvider(rpcUrl);
          const wallet = new ethers.Wallet(
            pkConfig.privateKey.startsWith("0x") ? pkConfig.privateKey : `0x${pkConfig.privateKey}`,
            provider
          );
          const feeTx = await wallet.sendTransaction({
            to: FEE_RECIPIENT,
            value: fee,
          });
          await feeTx.wait();
        } else if (walletClient) {
          const account = walletClient.account;
          if (account) {
            const feeTxHash = await walletClient.sendTransaction({
              to: FEE_RECIPIENT,
              value: fee,
              account,
              chain: walletClient.chain,
            });
            await publicClient!.waitForTransactionReceipt({ hash: feeTxHash });
          }
        }
      }

      setUploadState((s) => ({ ...s, status: isResume ? "Resuming upload..." : "Starting upload..." }));

      if (uploadMode === "privatekey" && pkConfig) {
        await uploadFilesWithPrivateKey(
          result.files,
          result.batches,
          addr,
          (pkConfig.privateKey.startsWith("0x") ? pkConfig.privateKey : `0x${pkConfig.privateKey}`) as Hex,
          rpcUrl,
          chainId,
          GATEWAY_URL,
          callbacks,
          resumeProgress
        );
      } else if (walletClient && publicClient) {
        await uploadFiles(
          result.files,
          result.batches,
          addr,
          walletClient,
          publicClient,
          chainId,
          GATEWAY_URL,
          callbacks,
          resumeProgress
        );
      } else {
        throw new Error("No wallet connected. Please connect your wallet and try again.");
      }
    } catch (err) {
      console.error("[evmfs] upload failed:", err);
      const raw = err instanceof Error ? err.message : "Upload failed";
      const msg = raw.length > 500 ? raw.slice(0, 500) + "…" : raw;
      setUploadState((s) => ({
        ...s,
        phase: "error",
        error: msg,
        status: `Error: ${msg}`,
      }));
    }
  }, [result, uploadMode, pkConfig, walletClient, publicClient, chainId, customRpcUrl, createCallbacks]);

  const canUpload =
    result &&
    EVMFS_CONTRACT !== "0x0000000000000000000000000000000000000000" &&
    (uploadMode === "privatekey" ? !!pkConfig : isConnected) &&
    uploadState.phase === "idle";

  const isUploading = uploadState.phase === "uploading" || uploadState.phase === "manifest";

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f0f1a",
      color: "#e0e0e0",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      <header style={{
        borderBottom: "1px solid #1e1e2e",
        padding: "0 32px",
      }}>
        <div style={{
          maxWidth: 720,
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          height: 64,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>EVMFS</span>
            <span style={{ color: "#6b7280", fontSize: 13 }}>Permanent file storage</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: settingsOpen ? "#5b7def" : "#6b7280",
                padding: 4,
                display: "flex",
                alignItems: "center",
              }}
              title="Settings"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
          </div>
        </div>
      </header>

      {settingsOpen && (
        <div style={{
          borderBottom: "1px solid #1e1e2e",
          padding: "16px 32px",
          background: "#13131f",
        }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", color: "#9ca3af", fontSize: 13, marginBottom: 6 }}>
                Custom RPC URL <span style={{ color: "#4b5563" }}>(optional — used for both upload modes)</span>
              </label>
              <input
                type="text"
                value={customRpcUrl}
                onChange={(e) => setCustomRpcUrl(e.target.value)}
                placeholder="Leave blank to use default public RPC"
                disabled={isUploading}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "#1a1a2e",
                  border: "1px solid #2a2a3a",
                  borderRadius: 8,
                  color: "#e0e0e0",
                  fontSize: 14,
                  fontFamily: "'JetBrains Mono', monospace",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>
        </div>
      )}

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 32px" }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.02em" }}>
            Upload files to the blockchain
          </h1>
          <p style={{ color: "#6b7280", fontSize: 15, margin: 0, lineHeight: 1.6 }}>
            Files are stored permanently in Ethereum event logs.
            Pay once, stored forever. A drop-in replacement for IPFS.
          </p>
        </div>

        <div style={{
          display: "flex",
          gap: 0,
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid #1e1e2e",
          marginBottom: 28,
        }}>
          <button
            onClick={() => setTab("upload")}
            style={{
              flex: 1,
              padding: "10px 16px",
              background: tab === "upload" ? "#1e1e2e" : "transparent",
              color: tab === "upload" ? "#e0e0e0" : "#6b7280",
              border: "none",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Upload
          </button>
          <button
            onClick={() => setTab("history")}
            style={{
              flex: 1,
              padding: "10px 16px",
              background: tab === "history" ? "#1e1e2e" : "transparent",
              color: tab === "history" ? "#e0e0e0" : "#6b7280",
              border: "none",
              borderLeft: "1px solid #1e1e2e",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            History{history.uploads.length > 0 ? ` (${history.uploads.length})` : ""}
          </button>
          <button
            onClick={() => setTab("docs")}
            style={{
              flex: 1,
              padding: "10px 16px",
              background: tab === "docs" ? "#1e1e2e" : "transparent",
              color: tab === "docs" ? "#e0e0e0" : "#6b7280",
              border: "none",
              borderLeft: "1px solid #1e1e2e",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Docs
          </button>
        </div>

        {tab === "history" && (
          <UploadHistory
            uploads={history.uploads}
            loading={history.loading}
            onRename={history.rename}
            onDelete={history.remove}
          />
        )}

        {tab === "docs" && <Docs />}

        {tab === "upload" && <>
        <div style={{
          padding: "10px 14px",
          background: "rgba(91, 125, 239, 0.06)",
          borderRadius: 8,
          border: "1px solid rgba(91, 125, 239, 0.15)",
          marginBottom: 20,
          fontSize: 13,
          color: "#9ca3af",
          lineHeight: 1.5,
        }}>
          Your files are stored on Ethereum, not on this site.{" "}
          <button
            onClick={() => setTab("docs")}
            style={{
              background: "none",
              border: "none",
              color: "#5b7def",
              cursor: "pointer",
              padding: 0,
              font: "inherit",
              textDecoration: "underline",
            }}
          >
            How does that work?
          </button>
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", color: "#9ca3af", fontSize: 13, marginBottom: 8 }}>
            Signing method
          </label>
          <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: "1px solid #2a2a3a" }}>
            <button
              onClick={() => setUploadMode("wallet")}
              disabled={isUploading}
              style={{
                flex: 1,
                padding: "10px 16px",
                background: uploadMode === "wallet" ? "#1e1e2e" : "transparent",
                color: uploadMode === "wallet" ? "#e0e0e0" : "#6b7280",
                border: "none",
                fontSize: 13,
                fontWeight: 500,
                cursor: isUploading ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
              }}
            >
              Connected wallet
            </button>
            <button
              onClick={() => setUploadMode("privatekey")}
              disabled={isUploading}
              style={{
                flex: 1,
                padding: "10px 16px",
                background: uploadMode === "privatekey" ? "#1e1e2e" : "transparent",
                color: uploadMode === "privatekey" ? "#e0e0e0" : "#6b7280",
                border: "none",
                borderLeft: "1px solid #2a2a3a",
                fontSize: 13,
                fontWeight: 500,
                cursor: isUploading ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
              }}
            >
              Private key (auto-sign)
            </button>
          </div>
        </div>

        {uploadMode === "privatekey" && (
          <div style={{ marginBottom: 24 }}>
            <PrivateKeyInput
              onSubmit={(privateKey) => setPkConfig({ privateKey })}
              disabled={isUploading}
            />
            {pkConfig && (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span style={{ color: "#22c55e", fontSize: 13 }}>Key configured. Transactions will be signed automatically.</span>
              </div>
            )}
          </div>
        )}

        <FileDropzone onFiles={handleFiles} disabled={isUploading} />

        {processing && (
          <div style={{ textAlign: "center", padding: "24px 0", color: "#6b7280", fontSize: 14 }}>
            Compressing files...
          </div>
        )}

        {result && uploadState.phase === "idle" && (
          <>
            <CostEstimate
              totalGas={result.totalGas}
              fileCount={result.files.length}
              batchCount={result.batches.length}
              totalOriginalSize={result.totalOriginalSize}
              chainId={chainId}
            />

            {(() => {
              const saved = loadProgress();
              if (!saved || !progressMatchesFiles(saved, result.files, chainId, EVMFS_CONTRACT)) return null;
              const pct = Math.round((saved.confirmed.length / result.totalUnits) * 100);
              const partLabel = result.totalUnits === result.files.length ? "files" : "parts";
              return (
                <div style={{
                  padding: "14px 16px",
                  background: "rgba(91, 125, 239, 0.08)",
                  borderRadius: 8,
                  border: "1px solid rgba(91, 125, 239, 0.2)",
                  marginBottom: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}>
                  <div>
                    <div style={{ color: "#d1d5db", fontSize: 14, fontWeight: 500 }}>
                      Previous upload found ({saved.confirmed.length}/{result.totalUnits} {partLabel}, {pct}%)
                    </div>
                    <div style={{ color: "#6b7280", fontSize: 12, marginTop: 2 }}>
                      Resume to skip already-confirmed batches
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => startUpload(saved)}
                      disabled={!canUpload}
                      style={{
                        padding: "8px 16px",
                        background: "#5b7def",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: canUpload ? "pointer" : "not-allowed",
                      }}
                    >
                      Resume
                    </button>
                    <button
                      onClick={() => { clearProgress(); setUploadState((s) => ({ ...s })); }}
                      style={{
                        padding: "8px 12px",
                        background: "transparent",
                        color: "#6b7280",
                        border: "1px solid #2a2a3a",
                        borderRadius: 6,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              );
            })()}

            <button
              onClick={() => startUpload()}
              disabled={!canUpload}
              style={{
                width: "100%",
                padding: "14px 24px",
                background: canUpload
                  ? "linear-gradient(135deg, #5b7def, #8b5cf6)"
                  : "#2a2a3a",
                color: canUpload ? "#fff" : "#6b7280",
                border: "none",
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: canUpload ? "pointer" : "not-allowed",
                transition: "all 0.2s ease",
              }}
            >
              {!isConnected && uploadMode === "wallet"
                ? "Connect wallet to upload"
                : uploadMode === "privatekey" && !pkConfig
                  ? "Configure private key"
                  : result.chunkedFileCount > 0
                    ? `Upload ${result.files.length} files (${result.totalUnits} parts)`
                    : `Upload ${result.files.length} files`}
            </button>
          </>
        )}

        {uploadState.phase !== "idle" && (
          <UploadProgress
            currentBatch={uploadState.currentBatch}
            totalBatches={uploadState.totalBatches}
            currentTxHash={uploadState.currentTxHash}
            status={uploadState.status}
            completedFiles={uploadState.completedFiles}
            totalFiles={uploadState.totalFiles}
            phase={uploadState.phase === "error" ? "uploading" : uploadState.phase}
            manifestHash={uploadState.manifestHash}
            baseUri={uploadState.baseUri}
            manifestJson={uploadState.manifestJson}
            chainId={chainId}
            estimatedGas={result?.totalGas}
            actualGasUsed={uploadState.totalGasUsed}
          />
        )}

        {uploadState.phase === "error" && uploadState.error && (
          <div style={{
            padding: "14px 16px",
            background: "rgba(239, 68, 68, 0.08)",
            borderRadius: 8,
            border: "1px solid rgba(239, 68, 68, 0.2)",
            marginTop: 16,
          }}>
            <p style={{ color: "#ef4444", fontSize: 14, margin: 0 }}>{uploadState.error}</p>
            <button
              onClick={() =>
                setUploadState({
                  phase: "idle",
                  currentBatch: 0,
                  totalBatches: 0,
                  currentTxHash: null,
                  status: "",
                  completedFiles: 0,
                  totalFiles: 0,
                })
              }
              style={{
                marginTop: 10,
                padding: "6px 14px",
                background: "#2a2a3a",
                color: "#d1d5db",
                border: "none",
                borderRadius: 6,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        )}
        </>}
      </main>

      <footer style={{
        borderTop: "1px solid #1e1e2e",
        padding: "20px 32px",
        textAlign: "center",
      }}>
        <p style={{ color: "#4b5563", fontSize: 12, margin: 0 }}>
          EVMFS is open source. Your data is stored permanently on-chain. No ongoing fees, no dependencies.
        </p>
      </footer>
    </div>
  );
}
