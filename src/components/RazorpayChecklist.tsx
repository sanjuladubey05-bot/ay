import { useState } from 'react';
import { ExternalLink, Lock, ShieldCheck } from 'lucide-react';
import type { ChecklistItemState, ChecklistStatus } from '../types/database';
import { ChecklistStatusLabel } from './StatusBadge';

const STATUS_OPTIONS: { value: ChecklistStatus; label: string }[] = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'requires_attention', label: 'Requires Attention' },
];

export function RazorpayChecklist({
  items,
  onUpdateStatus,
}: {
  items: ChecklistItemState[];
  onUpdateStatus: (key: string, status: ChecklistStatus, note?: string) => Promise<void>;
}) {
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const completedCount = items.filter((i) => i.status === 'completed').length;

  async function handleStatusChange(key: string, nextStatus: ChecklistStatus) {
    setSavingKey(key);
    setErrorMsg(null);
    try {
      await onUpdateStatus(key, nextStatus);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not update checklist status.');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <section aria-labelledby="payment-gateway-setup-heading" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <h2 id="payment-gateway-setup-heading" className="text-xl font-semibold text-white">
            PAYMENT GATEWAY SETUP
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Razorpay Standard Checkout &amp; UPI merchant verification readiness. Statuses are
            controlled by server configuration checks and authorized administrator confirmation.
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-semibold font-mono tabular-nums text-white">
            {completedCount} / {items.length}
          </div>
          <div className="text-xs text-zinc-400">Steps Completed</div>
        </div>
      </div>

      <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-4 flex items-start gap-3">
        <Lock className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-zinc-300 leading-relaxed">
          Compliance boundary: PAN, Aadhaar, GST certificates, and settlement bank documents must
          only be submitted inside the official{' '}
          <a
            href="https://dashboard.razorpay.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline hover:text-blue-300"
          >
            Razorpay Merchant Dashboard
          </a>
          . LPS STORE never collects or stores KYC documents.
        </p>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-200"
        >
          {errorMsg}
        </div>
      )}

      <div className="bg-[#111118] border border-white/[0.08] rounded-xl divide-y divide-white/[0.06]">
        {items.map((item) => {
          const isSaving = savingKey === item.key;
          return (
            <div
              key={item.key}
              className="p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
            >
              <div className="space-y-1.5 max-w-2xl">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono tabular-nums text-xs text-zinc-500">
                    {String(item.stepNumber).padStart(2, '0')}
                  </span>
                  <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                  <span className="text-xs text-zinc-500">·</span>
                  <ChecklistStatusLabel status={item.status} />
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed">{item.description}</p>
                {item.note && (
                  <p className="text-xs text-amber-300/90 flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{item.note}</span>
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <a
                  href={item.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 border border-white/[0.1] rounded-lg hover:bg-white/[0.04] hover:text-white transition-colors whitespace-nowrap"
                >
                  <span>{item.docsLabel}</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>

                <label className="sr-only" htmlFor={`checklist-${item.key}`}>
                  Status for {item.title}
                </label>
                <select
                  id={`checklist-${item.key}`}
                  value={item.status}
                  disabled={isSaving}
                  onChange={(e) =>
                    void handleStatusChange(item.key, e.target.value as ChecklistStatus)
                  }
                  className="bg-[#09090E] border border-white/[0.14] rounded-lg px-3 py-1.5 text-xs font-medium text-white focus:border-blue-500 disabled:opacity-50"
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
