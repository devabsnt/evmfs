import { useState, useEffect, useCallback } from "react";
import {
  type SavedUpload,
  getAllUploads,
  saveUpload,
  updateUploadLabel,
  deleteUpload,
} from "../lib/history";

export function useUploadHistory() {
  const [uploads, setUploads] = useState<SavedUpload[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUploads(await getAllUploads());
    } catch (err) {
      console.error("[evmfs] failed to load upload history:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async (upload: SavedUpload) => {
    await saveUpload(upload);
    await refresh();
  }, [refresh]);

  const rename = useCallback(async (id: string, label: string) => {
    await updateUploadLabel(id, label);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await deleteUpload(id);
    await refresh();
  }, [refresh]);

  return { uploads, loading, save, rename, remove };
}
