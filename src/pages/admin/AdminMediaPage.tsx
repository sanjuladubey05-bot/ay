import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Image as ImageIcon, Search, Trash2, Upload } from 'lucide-react';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog';
import { AdminLayout } from '../../layouts/AdminLayout';
import { ApiError, apiClient } from '../../services/apiClient';
import type { AdminMediaItem } from '../../types/api';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function AdminMediaPage() {
  const [media, setMedia] = useState<AdminMediaItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AdminMediaItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadMedia = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.getAdminMedia(search.trim() || undefined);
      setMedia(res.media);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load media library.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  async function handleUploadFile(file: File) {
    setErrorMsg(null);
    setSuccessMsg(null);
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setErrorMsg('Only JPG, PNG, and WebP images are permitted.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Image exceeds maximum 5 MB upload size.');
      return;
    }

    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      await apiClient.uploadAdminMedia({
        fileName: file.name,
        mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
        dataBase64: base64,
        altText: file.name.replace(/\.[^.]+$/, ''),
      });
      setSuccessMsg(`Uploaded "${file.name}" to Media Library.`);
      await loadMedia();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await apiClient.deleteAdminMedia(deleteTarget.id);
      setSuccessMsg(`Deleted "${deleteTarget.altText || deleteTarget.storagePath}".`);
      setDeleteTarget(null);
      await loadMedia();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDeleteError(err.message);
      } else {
        setDeleteError(err instanceof Error ? err.message : 'Unable to delete image.');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <AdminLayout title="Media Library">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Media Library</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Upload and reuse verified game covers, currency icons, package artwork, and store logos
              (JPG, PNG, WebP up to 5 MB).
            </p>
          </div>

          <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 cursor-pointer self-start whitespace-nowrap">
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>{uploading ? 'Uploading...' : 'Upload Image'}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleUploadFile(file);
              }}
              className="sr-only"
            />
          </label>
        </div>

        {successMsg && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200"
          >
            {errorMsg}
          </div>
        )}

        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-4">
          <div className="relative max-w-md">
            <Search
              className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search uploaded assets..."
              aria-label="Search uploaded assets"
              className="w-full rounded-lg bg-[#09090E] border border-white/[0.12] pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-8 text-sm text-zinc-400">
            Loading media assets...
          </div>
        ) : media.length === 0 ? (
          <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-10 text-center space-y-2">
            <ImageIcon className="h-7 w-7 text-zinc-500 mx-auto" aria-hidden="true" />
            <p className="text-sm font-semibold text-white">No uploaded images yet</p>
            <p className="text-xs text-zinc-400">
              Upload a JPG, PNG, or WebP asset above to attach it to games, currencies, or packages.
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {media.map((item) => (
              <div
                key={item.id}
                className="bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col"
              >
                <div className="aspect-[16/10] bg-[#09090E] border-b border-white/[0.06] overflow-hidden">
                  <img
                    src={item.publicUrl}
                    alt={item.altText || item.storagePath}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-3.5 space-y-2 flex-1 flex flex-col justify-between text-xs">
                  <div>
                    <div className="font-medium text-white truncate">
                      {item.altText || item.storagePath}
                    </div>
                    <div className="font-mono text-[11px] text-zinc-400">
                      {formatBytes(item.byteSize)} · {item.mimeType.replace('image/', '').toUpperCase()}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {item.referenceCount} catalog reference(s)
                    </div>
                  </div>
                  <div className="pt-2 flex items-center justify-between gap-2 border-t border-white/[0.06]">
                    <span className="font-mono text-[10px] text-zinc-500 truncate">
                      {item.publicUrl}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(item);
                      }}
                      aria-label={`Delete ${item.altText || item.storagePath}`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-500/25 text-red-300 hover:bg-red-500/10 shrink-0"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete Media Asset?`}
        message="Deleting an image permanently removes it from the server disk. Images currently linked to active games, currencies, or packages are protected from accidental deletion."
        confirmLabel="Delete Asset"
        destructive
        loading={deleteLoading}
        errorMessage={deleteError}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
    </AdminLayout>
  );
}
