import { useEffect, useId, useState, type ChangeEvent } from 'react';
import { Image as ImageIcon, Search, Trash2, Upload, X } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import type { AdminMediaItem } from '../../types/api';

interface MediaPickerFieldProps {
  label: string;
  imageUrl: string | null;
  mediaId: string | null;
  onChange: (next: { imageUrl: string | null; mediaId: string | null }) => void;
  helperText?: string;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

const ALLOWED_MIME_LIST = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function MediaPickerField({
  label,
  imageUrl,
  mediaId,
  onChange,
  helperText = 'Supports JPG, PNG, or WebP up to 5 MB.',
}: MediaPickerFieldProps) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [mediaList, setMediaList] = useState<AdminMediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [mediaSearch, setMediaSearch] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    setPreviewFailed(false);
  }, [imageUrl]);

  async function loadMediaLibrary(query = '') {
    setLoadingMedia(true);
    try {
      const res = await apiClient.getAdminMedia(query);
      setMediaList(res.media);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Unable to load media library.');
    } finally {
      setLoadingMedia(false);
    }
  }

  async function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ALLOWED_MIME_LIST.includes(file.type as (typeof ALLOWED_MIME_LIST)[number])) {
      setUploadError('Only JPG, PNG, and WebP images are permitted.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image file size must not exceed 5 MB.');
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const dataBase64 = await readFileAsBase64(file);
      const res = await apiClient.uploadAdminMedia({
        fileName: file.name,
        mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
        dataBase64,
        altText: file.name.replace(/\.[^.]+$/, ''),
      });
      onChange({ imageUrl: res.media.publicUrl, mediaId: res.media.id });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Image upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function openPicker() {
    setLibraryOpen(true);
    void loadMediaLibrary(mediaSearch);
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-zinc-300">{label}</div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl border border-white/[0.1] bg-[#09090E] p-3.5">
        <div className="h-20 w-24 rounded-lg overflow-hidden border border-white/[0.08] bg-[#111118] shrink-0 flex items-center justify-center">
          {imageUrl && !previewFailed ? (
            <img
              src={imageUrl}
              alt={label}
              referrerPolicy="no-referrer"
              onError={() => setPreviewFailed(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <ImageIcon className="h-6 w-6 text-zinc-600" aria-hidden="true" />
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor={inputId}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 transition-colors cursor-pointer whitespace-nowrap ${
                uploading ? 'opacity-60 pointer-events-none' : ''
              }`}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{uploading ? 'Uploading...' : 'Upload Image'}</span>
            </label>
            <input
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => void handleFileSelect(e)}
              className="sr-only"
            />

            <button
              type="button"
              onClick={openPicker}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.14] text-xs font-medium text-zinc-200 hover:bg-white/[0.06] whitespace-nowrap"
            >
              <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Media Library</span>
            </button>

            {imageUrl && (
              <button
                type="button"
                onClick={() => onChange({ imageUrl: null, mediaId: null })}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/[0.12] text-xs font-medium text-zinc-400 hover:text-red-300 hover:border-red-500/30 whitespace-nowrap"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Clear</span>
              </button>
            )}
          </div>

          <p className="text-[11px] text-zinc-500 truncate">
            {imageUrl ? `${mediaId ? 'Stored in Media Library · ' : ''}${imageUrl}` : helperText}
          </p>
        </div>
      </div>

      {uploadError && (
        <p role="alert" className="text-xs text-red-400">
          {uploadError}
        </p>
      )}

      {libraryOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Choose Image from Media Library"
        >
          <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border border-white/[0.12] bg-[#111118] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-white">Choose from Media Library</h3>
              <button
                type="button"
                onClick={() => setLibraryOpen(false)}
                aria-label="Close media library picker"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-white/[0.06] flex flex-wrap items-center gap-3 bg-[#0D0D14]">
              <div className="relative flex-1 min-w-[200px]">
                <Search
                  className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={mediaSearch}
                  onChange={(e) => {
                    const next = e.target.value;
                    setMediaSearch(next);
                    void loadMediaLibrary(next);
                  }}
                  placeholder="Search uploaded files..."
                  aria-label="Search uploaded media"
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.12] pl-9 pr-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:border-blue-500"
                />
              </div>
              <span className="text-xs text-zinc-400 tabular-nums">
                {mediaList.length} files
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {loadingMedia ? (
                <div className="py-12 text-center text-sm text-zinc-400">
                  Loading uploaded media...
                </div>
              ) : mediaList.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <p className="text-sm font-medium text-white">No uploaded images yet</p>
                  <p className="text-xs text-zinc-400">
                    Upload a JPG, PNG, or WebP file using the Upload Image button.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {mediaList.map((item) => {
                    const selected = imageUrl === item.publicUrl;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onChange({ imageUrl: item.publicUrl, mediaId: item.id });
                          setLibraryOpen(false);
                        }}
                        className={`text-left rounded-lg overflow-hidden border transition-all ${
                          selected
                            ? 'border-violet-500 ring-1 ring-violet-500/60 bg-violet-600/15'
                            : 'border-white/[0.08] bg-[#09090E] hover:border-white/[0.25]'
                        }`}
                      >
                        <div className="aspect-[4/3] bg-[#0D0D14] overflow-hidden">
                          <img
                            src={item.publicUrl}
                            alt={item.altText || item.storagePath}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="p-2 space-y-0.5">
                          <div className="text-xs font-medium text-white truncate">
                            {item.altText || item.storagePath}
                          </div>
                          <div className="text-[11px] font-mono tabular-nums text-zinc-400">
                            {Math.max(1, Math.round(item.byteSize / 1024))} KB
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
