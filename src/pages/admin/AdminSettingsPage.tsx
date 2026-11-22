import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { RazorpayChecklist } from '../../components/RazorpayChecklist';
import { AdminLayout } from '../../layouts/AdminLayout';
import { ApiError, apiClient } from '../../services/apiClient';
import type { AdminSettingsResponse } from '../../types/api';
import type { ChecklistStatus, PaymentMode } from '../../types/database';

function EnvRow({ label, configured, detail }: { label: string; configured: boolean; detail: string }) {
  return (
    <div className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
      <div>
        <div className="font-mono text-xs font-medium text-white">{label}</div>
        <div className="text-xs text-zinc-400">{detail}</div>
      </div>
      {configured ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Configured</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 whitespace-nowrap">
          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Missing</span>
        </span>
      )}
    </div>
  );
}

export function AdminSettingsPage() {
  const [settings, setSettings] = useState<AdminSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<{ message: string; blockers?: string[] } | null>(null);
  const [updatingMode, setUpdatingMode] = useState(false);

  async function fetchSettings() {
    try {
      const res = await apiClient.getAdminSettings();
      setSettings(res);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load settings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchSettings();
  }, []);

  async function handleChecklistUpdate(key: string, status: ChecklistStatus, note?: string) {
    const res = await apiClient.updateChecklistItem({ key, status, note });
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            checklist: res.checklist,
            liveModeEligible: res.liveModeEligible,
            liveModeBlockers: res.liveModeBlockers,
          }
        : prev
    );
  }

  async function handleModeSwitch(mode: PaymentMode) {
    setUpdatingMode(true);
    setModeError(null);
    try {
      const res = await apiClient.updatePaymentMode(mode);
      setSettings((prev) => (prev ? { ...prev, paymentMode: res.paymentMode } : prev));
    } catch (err) {
      if (err instanceof ApiError) {
        setModeError({ message: err.message, blockers: err.blockers });
      } else {
        setModeError({
          message: err instanceof Error ? err.message : 'Could not change payment mode.',
        });
      }
    } finally {
      setUpdatingMode(false);
    }
  }

  return (
    <AdminLayout title="Gateway & Settings">
      {loading ? (
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-8 text-sm text-zinc-400">
          Loading Razorpay configuration and readiness checklist...
        </div>
      ) : loadError || !settings ? (
        <div
          role="alert"
          className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-sm text-red-200"
        >
          {loadError || 'Settings unavailable.'}
        </div>
      ) : (
        <div className="space-y-10">
          {/* Payment Mode & Safety Lock */}
          <section className="grid lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 bg-[#111118] border border-white/[0.08] rounded-xl p-6 space-y-5">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-white">Razorpay Execution Mode</h2>
                <p className="text-sm text-zinc-400">
                  Defaults to Test Mode. Live Mode remains locked until live credentials,
                  webhook secret, and merchant readiness prerequisites are complete.
                </p>
              </div>

              <div className="flex items-center gap-2 p-1 bg-[#09090E] border border-white/[0.08] rounded-lg w-fit">
                <button
                  type="button"
                  disabled={updatingMode}
                  onClick={() => void handleModeSwitch('test')}
                  className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    settings.paymentMode === 'test'
                      ? 'bg-violet-600 text-white'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Test Mode (Safe Default)
                </button>
                <button
                  type="button"
                  disabled={updatingMode}
                  onClick={() => void handleModeSwitch('live')}
                  className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    settings.paymentMode === 'live'
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Live Mode
                </button>
              </div>

              {modeError && (
                <div
                  role="alert"
                  className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-2 text-xs text-amber-200"
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{modeError.message}</span>
                  </div>
                  {modeError.blockers && modeError.blockers.length > 0 && (
                    <ul className="list-disc pl-5 space-y-1 text-amber-200/90 max-h-28 overflow-y-auto pr-2">
                      {modeError.blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {!settings.liveModeEligible && (
                <div className="pt-2 border-t border-white/[0.08] space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                    <span>Live Mode Gatekeeper ({settings.liveModeBlockers.length} blockers)</span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Live transactions are blocked on the server until live credentials and
                    checklist verification are complete.
                  </p>
                </div>
              )}
            </div>

            {/* Server Environment Readiness (redacted booleans only) */}
            <div className="lg:col-span-6 bg-[#111118] border border-white/[0.08] rounded-xl p-6 space-y-3">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-white">
                  Server Environment Readiness
                </h2>
                <p className="text-xs text-zinc-400">
                  Secret values stay exclusively in server environment variables and are never
                  sent to the browser.
                </p>
              </div>

              <div className="divide-y divide-white/[0.06]">
                <EnvRow
                  label="RAZORPAY_KEY_ID"
                  configured={settings.envReadiness.razorpayKeyIdConfigured}
                  detail={`Detected key type: ${settings.envReadiness.razorpayKeyType}`}
                />
                <EnvRow
                  label="RAZORPAY_KEY_SECRET"
                  configured={settings.envReadiness.razorpayKeySecretConfigured}
                  detail="Server-side HMAC signature verification & Orders API"
                />
                <EnvRow
                  label="RAZORPAY_WEBHOOK_SECRET"
                  configured={settings.envReadiness.razorpayWebhookSecretConfigured}
                  detail="Required for /api/payments/webhook reconciliation"
                />
                <EnvRow
                  label="SUPABASE_URL & SUPABASE_ANON_KEY"
                  configured={
                    settings.envReadiness.supabaseUrlConfigured &&
                    settings.envReadiness.supabaseAnonKeyConfigured
                  }
                  detail="Live Supabase project connection"
                />
                <EnvRow
                  label="SUPABASE_SERVICE_ROLE_KEY"
                  configured={settings.envReadiness.supabaseServiceRoleConfigured}
                  detail="Server-only privileged client (never exposed to browser)"
                />
              </div>
            </div>
          </section>

          {/* 12-item Razorpay Business Readiness Checklist */}
          <RazorpayChecklist
            items={settings.checklist}
            onUpdateStatus={handleChecklistUpdate}
          />
        </div>
      )}
    </AdminLayout>
  );
}
