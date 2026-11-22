import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  errorMessage?: string | null;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  errorMessage = null,
  secondaryActionLabel,
  onSecondaryAction,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl border border-white/[0.12] bg-[#111118] p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                destructive ? 'bg-red-500/15 text-red-400' : 'bg-violet-600/15 text-violet-400'
              }`}
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </div>
            <h2 id="confirm-dialog-title" className="text-base font-semibold text-white">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            aria-label="Close confirmation dialog"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="text-sm text-zinc-300 leading-relaxed">{message}</p>

        {errorMessage && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200 leading-relaxed"
          >
            {errorMessage}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg border border-white/[0.14] text-xs font-medium text-zinc-200 hover:bg-white/[0.06] whitespace-nowrap disabled:opacity-50"
          >
            {cancelLabel}
          </button>

          {secondaryActionLabel && onSecondaryAction && (
            <button
              type="button"
              onClick={onSecondaryAction}
              disabled={loading}
              className="px-4 py-2 rounded-lg border border-amber-500/40 bg-amber-500/15 text-xs font-medium text-amber-200 hover:bg-amber-500/25 whitespace-nowrap disabled:opacity-50"
            >
              {secondaryActionLabel}
            </button>
          )}

          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-lg text-xs font-semibold text-white whitespace-nowrap disabled:opacity-50 ${
              destructive
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-violet-600 hover:bg-violet-500'
            }`}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
