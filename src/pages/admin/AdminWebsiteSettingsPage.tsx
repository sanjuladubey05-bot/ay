import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ExternalLink, Globe, Megaphone, Save } from 'lucide-react';
import { MediaPickerField } from '../../components/admin/MediaPickerField';
import { ROUTES } from '../../configuration/routes';
import { useStorefrontSettings } from '../../hooks/useStorefrontSettings';
import { AdminLayout } from '../../layouts/AdminLayout';
import { apiClient } from '../../services/apiClient';
import type { StorefrontIdentitySettings } from '../../types/database';

export function AdminWebsiteSettingsPage() {
  const { refreshSettings } = useStorefrontSettings();
  const [form, setForm] = useState<StorefrontIdentitySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getAdminWebsiteSettings()
      .then((res) => setForm(res.settings))
      .catch((err) =>
        setErrorMsg(err instanceof Error ? err.message : 'Unable to load website settings.')
      )
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await apiClient.updateAdminWebsiteSettings(form);
      setForm(res.settings);
      await refreshSettings();
      setSuccessMsg('Website settings saved and published to storefront immediately.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update website settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout title="Website Settings">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Website Settings</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Update store identity, homepage hero copy, announcement banner, and support contact
              details reflected across the live LPS STORE storefront.
            </p>
          </div>
          <Link
            to={ROUTES.ADMIN_SETTINGS}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/[0.14] text-xs font-medium text-zinc-200 hover:bg-white/[0.05] self-start whitespace-nowrap"
          >
            <span>Razorpay Gateway Readiness</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        {loading || !form ? (
          <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-8 text-sm text-zinc-400">
            {errorMsg || 'Loading website settings...'}
          </div>
        ) : (
          <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
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

            {/* Branding & Hero */}
            <section className="bg-[#111118] border border-white/[0.08] rounded-xl p-6 space-y-5">
              <div className="flex items-center gap-2 border-b border-white/[0.08] pb-3">
                <Globe className="h-4 w-4 text-violet-400" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-white">Store Branding &amp; Homepage Hero</h3>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="ws-store-name" className="block text-xs font-medium text-zinc-300">
                    Store Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="ws-store-name"
                    type="text"
                    required
                    value={form.storeName}
                    onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="ws-hero-sub" className="block text-xs font-medium text-zinc-300">
                    Hero Subtitle <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="ws-hero-sub"
                    type="text"
                    required
                    value={form.heroSubtitle}
                    onChange={(e) => setForm({ ...form, heroSubtitle: e.target.value })}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="ws-hero-head" className="block text-xs font-medium text-zinc-300">
                  Homepage Hero Heading <span className="text-red-400">*</span>
                </label>
                <input
                  id="ws-hero-head"
                  type="text"
                  required
                  value={form.heroHeading}
                  onChange={(e) => setForm({ ...form, heroHeading: e.target.value })}
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                />
              </div>

              <MediaPickerField
                label="Store Logo (Optional)"
                imageUrl={form.storeLogoUrl}
                mediaId={null}
                onChange={({ imageUrl }) => setForm({ ...form, storeLogoUrl: imageUrl })}
              />

              <div className="space-y-1.5">
                <label htmlFor="ws-footer-desc" className="block text-xs font-medium text-zinc-300">
                  Footer Description
                </label>
                <textarea
                  id="ws-footer-desc"
                  rows={2}
                  value={form.footerDescription}
                  onChange={(e) => setForm({ ...form, footerDescription: e.target.value })}
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                />
              </div>
            </section>

            {/* Announcement Bar */}
            <section className="bg-[#111118] border border-white/[0.08] rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                <div className="flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-blue-400" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-white">Storefront Announcement Banner</h3>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-zinc-200">
                  <input
                    type="checkbox"
                    checked={form.announcementEnabled}
                    onChange={(e) => setForm({ ...form, announcementEnabled: e.target.checked })}
                    className="rounded border-white/20 bg-[#09090E]"
                  />
                  <span>Show Top Announcement</span>
                </label>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="ws-announce" className="block text-xs font-medium text-zinc-300">
                  Announcement Message
                </label>
                <input
                  id="ws-announce"
                  type="text"
                  maxLength={240}
                  value={form.announcementText}
                  onChange={(e) => setForm({ ...form, announcementText: e.target.value })}
                  placeholder="e.g. Weekend bonus VP packs now live across VALORANT India!"
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                />
              </div>
            </section>

            {/* Support & Social Links */}
            <section className="bg-[#111118] border border-white/[0.08] rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-semibold text-white border-b border-white/[0.08] pb-3">
                Customer Support &amp; Social Links
              </h3>

              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="ws-email" className="block text-xs font-medium text-zinc-300">
                    Support Email
                  </label>
                  <input
                    id="ws-email"
                    type="email"
                    required
                    value={form.supportEmail}
                    onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="ws-wa" className="block text-xs font-medium text-zinc-300">
                    WhatsApp Contact
                  </label>
                  <input
                    id="ws-wa"
                    type="text"
                    value={form.whatsappContact}
                    onChange={(e) => setForm({ ...form, whatsappContact: e.target.value })}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm font-mono text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="ws-hours" className="block text-xs font-medium text-zinc-300">
                    Support Hours
                  </label>
                  <input
                    id="ws-hours"
                    type="text"
                    value={form.supportHours}
                    onChange={(e) => setForm({ ...form, supportHours: e.target.value })}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="ws-note" className="block text-xs font-medium text-zinc-300">
                  Contact Page Support Note
                </label>
                <input
                  id="ws-note"
                  type="text"
                  value={form.supportNote}
                  onChange={(e) => setForm({ ...form, supportNote: e.target.value })}
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                />
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                <div className="space-y-1">
                  <label htmlFor="ws-discord" className="block text-[11px] text-zinc-400">
                    Discord URL
                  </label>
                  <input
                    id="ws-discord"
                    type="text"
                    value={form.socialLinks.discord}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        socialLinks: { ...form.socialLinks, discord: e.target.value },
                      })
                    }
                    placeholder="https://discord.gg/..."
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="ws-insta" className="block text-[11px] text-zinc-400">
                    Instagram URL
                  </label>
                  <input
                    id="ws-insta"
                    type="text"
                    value={form.socialLinks.instagram}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        socialLinks: { ...form.socialLinks, instagram: e.target.value },
                      })
                    }
                    placeholder="https://instagram.com/..."
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="ws-yt" className="block text-[11px] text-zinc-400">
                    YouTube URL
                  </label>
                  <input
                    id="ws-yt"
                    type="text"
                    value={form.socialLinks.youtube}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        socialLinks: { ...form.socialLinks, youtube: e.target.value },
                      })
                    }
                    placeholder="https://youtube.com/..."
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="ws-x" className="block text-[11px] text-zinc-400">
                    X / Twitter URL
                  </label>
                  <input
                    id="ws-x"
                    type="text"
                    value={form.socialLinks.x}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        socialLinks: { ...form.socialLinks, x: e.target.value },
                      })
                    }
                    placeholder="https://x.com/..."
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-1.5 text-xs text-white"
                  />
                </div>
              </div>
            </section>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                <span>{saving ? 'Publishing Changes...' : 'Save Website Settings'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminLayout>
  );
}
