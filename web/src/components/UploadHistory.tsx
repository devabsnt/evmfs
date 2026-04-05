import { useState } from "react";
import type { SavedUpload } from "../lib/history";

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  11155111: "Sepolia",
};

interface UploadHistoryProps {
  uploads: SavedUpload[];
  loading: boolean;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
}

export function UploadHistory({ uploads, loading, onRename, onDelete }: UploadHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const exportAsJson = (upload: SavedUpload) => {
    const data = upload.files.map((f) => ({
      index: f.index,
      filename: f.filename,
      contentHash: f.contentHash,
      url: `${upload.baseUri}${f.index}`,
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${upload.label || "evmfs-upload"}-${upload.manifestHash.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div style={{ color: "#6b7280", fontSize: 14, padding: "24px 0" }}>Loading history...</div>;
  }

  if (uploads.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center" }}>
        <div style={{ color: "#4b5563", fontSize: 14 }}>No uploads yet</div>
        <div style={{ color: "#374151", fontSize: 13, marginTop: 4 }}>
          Completed uploads will appear here
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {uploads.map((upload) => {
        const isExpanded = expandedId === upload.id;
        const isEditing = editingId === upload.id;
        const chainName = CHAIN_NAMES[upload.chainId] || `Chain ${upload.chainId}`;
        const date = new Date(upload.timestamp);
        const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
        const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

        return (
          <div
            key={upload.id}
            style={{
              background: "#13131f",
              borderRadius: 10,
              border: "1px solid #1e1e2e",
              overflow: "hidden",
            }}
          >
            <div
              onClick={() => setExpandedId(isExpanded ? null : upload.id)}
              style={{
                padding: "14px 16px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                {isEditing ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => {
                      onRename(upload.id, editValue.trim() || upload.label);
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onRename(upload.id, editValue.trim() || upload.label);
                        setEditingId(null);
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: "#1a1a2e",
                      border: "1px solid #5b7def",
                      borderRadius: 4,
                      color: "#e0e0e0",
                      fontSize: 14,
                      fontWeight: 500,
                      padding: "2px 8px",
                      outline: "none",
                      minWidth: 0,
                      flex: 1,
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingId(upload.id);
                      setEditValue(upload.label);
                    }}
                    style={{
                      color: "#e0e0e0",
                      fontSize: 14,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title="Double-click to rename"
                  >
                    {upload.label}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, marginLeft: 12 }}>
                <span style={{ color: "#6b7280", fontSize: 12 }}>{upload.fileCount} files</span>
                <span style={{
                  color: "#4b5563",
                  fontSize: 11,
                  background: "#1a1a2e",
                  padding: "2px 8px",
                  borderRadius: 4,
                }}>
                  {chainName}
                </span>
                <span style={{ color: "#4b5563", fontSize: 12 }}>{dateStr}</span>
              </div>
            </div>

            {isExpanded && (
              <div style={{ borderTop: "1px solid #1e1e2e", padding: "16px" }}>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 4 }}>Base URI</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{
                      color: "#5b7def",
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono', monospace",
                      background: "#1a1a2e",
                      padding: "6px 10px",
                      borderRadius: 6,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {upload.baseUri}
                    </code>
                    <CopyButton
                      onClick={() => copyToClipboard(upload.baseUri, `uri-${upload.id}`)}
                      copied={copiedField === `uri-${upload.id}`}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 4 }}>Manifest hash</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{
                      color: "#d1d5db",
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono', monospace",
                      background: "#1a1a2e",
                      padding: "6px 10px",
                      borderRadius: 6,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {upload.manifestHash}
                    </code>
                    <CopyButton
                      onClick={() => copyToClipboard(upload.manifestHash, `hash-${upload.id}`)}
                      copied={copiedField === `hash-${upload.id}`}
                    />
                  </div>
                </div>

                <div style={{
                  display: "flex", gap: 16, marginBottom: 16,
                  color: "#4b5563", fontSize: 12,
                }}>
                  <span>{timeStr}</span>
                  <span>{Number(upload.totalGasUsed).toLocaleString()} gas</span>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 6 }}>
                    Files ({upload.fileCount})
                  </div>
                  <div style={{
                    background: "#1a1a2e",
                    borderRadius: 6,
                    maxHeight: 240,
                    overflow: "auto",
                  }}>
                    {upload.files.map((f) => (
                      <div
                        key={f.index}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "6px 10px",
                          borderBottom: "1px solid #1e1e2e",
                          fontSize: 12,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        <span style={{ color: "#9ca3af" }}>{f.filename}</span>
                        <span
                          onClick={() => copyToClipboard(f.contentHash, `file-${upload.id}-${f.index}`)}
                          style={{
                            color: copiedField === `file-${upload.id}-${f.index}` ? "#22c55e" : "#4b5563",
                            cursor: "pointer",
                          }}
                          title="Click to copy hash"
                        >
                          {copiedField === `file-${upload.id}-${f.index}` ? "copied" : f.contentHash.slice(0, 10) + "..." + f.contentHash.slice(-6)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <ActionButton onClick={() => exportAsJson(upload)}>
                    Export JSON
                  </ActionButton>
                  <ActionButton onClick={() => {
                    const json = upload.files.map((f) => ({
                      index: f.index,
                      filename: f.filename,
                      contentHash: f.contentHash,
                      url: `${upload.baseUri}${f.index}`,
                    }));
                    copyToClipboard(JSON.stringify(json, null, 2), `json-${upload.id}`);
                  }}>
                    {copiedField === `json-${upload.id}` ? "Copied!" : "Copy as JSON"}
                  </ActionButton>
                  <ActionButton onClick={() => {
                    setEditingId(upload.id);
                    setEditValue(upload.label);
                  }}>
                    Rename
                  </ActionButton>
                  <ActionButton
                    onClick={() => { if (confirm("Delete this upload from history?")) onDelete(upload.id); }}
                    danger
                  >
                    Delete
                  </ActionButton>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CopyButton({ onClick, copied }: { onClick: () => void; copied: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        background: "none",
        border: "1px solid #2a2a3a",
        borderRadius: 4,
        padding: "4px 8px",
        cursor: "pointer",
        color: copied ? "#22c55e" : "#6b7280",
        fontSize: 11,
        flexShrink: 0,
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function ActionButton({ onClick, children, danger }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        background: "transparent",
        color: danger ? "#ef4444" : "#9ca3af",
        border: `1px solid ${danger ? "rgba(239, 68, 68, 0.3)" : "#2a2a3a"}`,
        borderRadius: 6,
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
