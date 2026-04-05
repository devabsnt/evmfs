import { useCallback, useState, useRef } from "react";

interface FileDropzoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export function FileDropzone({ onFiles, disabled }: FileDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    },
    [onFiles, disabled]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length > 0) onFiles(files);
    },
    [onFiles]
  );

  return (
    <div
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragActive ? "#5b7def" : "#3a3a4a"}`,
        borderRadius: 12,
        padding: "48px 32px",
        textAlign: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        background: dragActive ? "rgba(91, 125, 239, 0.05)" : "transparent",
        transition: "all 0.2s ease",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={handleChange}
        style={{ display: "none" }}
        disabled={disabled}
      />
      <div style={{ fontSize: 40, marginBottom: 12, lineHeight: 1 }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <p style={{ color: "#e0e0e0", fontSize: 16, margin: "0 0 8px" }}>
        Drop files here or click to browse
      </p>
      <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>
        Supports any file type. Files are sorted alphanumerically (index = tokenId).
      </p>
    </div>
  );
}
