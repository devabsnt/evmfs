import { useCallback, useState, useRef } from "react";

interface FileWithPath extends File {
  readonly relativePath: string;
}

function createFileWithPath(file: File, relativePath: string): FileWithPath {
  return Object.assign(file, { relativePath });
}

interface FileDropzoneProps {
  onFiles: (files: FileWithPath[]) => void;
  disabled?: boolean;
  mode?: "files" | "folder";
}

async function traverseEntry(entry: FileSystemEntry, basePath: string): Promise<FileWithPath[]> {
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      (entry as FileSystemFileEntry).file((file) => {
        const relPath = basePath ? `${basePath}/${file.name}` : file.name;
        resolve([createFileWithPath(file, relPath)]);
      }, reject);
    });
  }
  if (entry.isDirectory) {
    const dirReader = (entry as FileSystemDirectoryEntry).createReader();
    const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      const all: FileSystemEntry[] = [];
      const readBatch = () => {
        dirReader.readEntries((batch) => {
          if (batch.length === 0) {
            resolve(all);
          } else {
            all.push(...batch);
            readBatch();
          }
        }, reject);
      };
      readBatch();
    });
    const results: FileWithPath[] = [];
    for (const child of entries) {
      if (child.name.startsWith(".")) continue;
      const childPath = basePath ? `${basePath}/${child.name}` : child.name;
      const childFiles = await traverseEntry(child, childPath);
      results.push(...childFiles);
    }
    return results;
  }
  return [];
}

export type { FileWithPath };

export function FileDropzone({ onFiles, disabled, mode = "files" }: FileDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isFolder = mode === "folder";

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
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (disabled) return;

      if (isFolder && e.dataTransfer.items) {
        const allFiles: FileWithPath[] = [];
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
          const item = e.dataTransfer.items[i];
          const entry = item.webkitGetAsEntry?.();
          if (entry) {
            // For top-level directory entries, don't include the dir name in paths
            if (entry.isDirectory) {
              const dirReader = (entry as FileSystemDirectoryEntry).createReader();
              const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
                const all: FileSystemEntry[] = [];
                const readBatch = () => {
                  dirReader.readEntries((batch) => {
                    if (batch.length === 0) resolve(all);
                    else { all.push(...batch); readBatch(); }
                  }, reject);
                };
                readBatch();
              });
              for (const child of entries) {
                if (child.name.startsWith(".")) continue;
                const files = await traverseEntry(child, child.name);
                allFiles.push(...files);
              }
            } else {
              const files = await traverseEntry(entry, "");
              allFiles.push(...files);
            }
          }
        }
        if (allFiles.length > 0) onFiles(allFiles);
      } else {
        const files = Array.from(e.dataTransfer.files).map((f) =>
          createFileWithPath(f, f.name)
        );
        if (files.length > 0) onFiles(files);
      }
    },
    [onFiles, disabled, isFolder]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawFiles = e.target.files ? Array.from(e.target.files) : [];
      if (rawFiles.length === 0) return;

      if (isFolder) {
        // webkitRelativePath gives "folderName/sub/file.txt" — strip the leading folder name
        const filesWithPaths = rawFiles
          .filter((f) => !f.name.startsWith("."))
          .map((f) => {
            const rel = (f as { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
            // Strip leading folder name
            const parts = rel.split("/");
            const trimmed = parts.length > 1 ? parts.slice(1).join("/") : rel;
            return createFileWithPath(f, trimmed);
          });
        if (filesWithPaths.length > 0) onFiles(filesWithPaths);
      } else {
        const files = rawFiles.map((f) => createFileWithPath(f, f.name));
        if (files.length > 0) onFiles(files);
      }
    },
    [onFiles, isFolder]
  );

  // Build input props conditionally for folder mode
  const inputProps: Record<string, unknown> = {};
  if (isFolder) {
    inputProps.webkitdirectory = "";
  }

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
        multiple={!isFolder}
        onChange={handleChange}
        style={{ display: "none" }}
        disabled={disabled}
        {...inputProps}
      />
      <div style={{ fontSize: 40, marginBottom: 12, lineHeight: 1 }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {isFolder ? (
            <>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <polyline points="9 14 12 11 15 14" />
            </>
          ) : (
            <>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </>
          )}
        </svg>
      </div>
      <p style={{ color: "#e0e0e0", fontSize: 16, margin: "0 0 8px" }}>
        {isFolder ? "Drop a folder here or click to browse" : "Drop files here or click to browse"}
      </p>
      <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>
        {isFolder
          ? "Directory structure and filenames are preserved in the manifest."
          : "Supports any file type. Files are sorted alphanumerically (index = tokenId)."}
      </p>
    </div>
  );
}
