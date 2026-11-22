import { useState, type FormEvent } from 'react';
import { CheckCircle2, Clock, Mail, MessageSquare } from 'lucide-react';
import { useStorefrontSettings } from '../../hooks/useStorefrontSettings';
import { apiClient } from '../../services/apiClient';

export function ContactPage() {
  const { settings } = useStorefrontSettings();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.submitContactInquiry({ name, email, subject, message });
      setSubmittedId(res.id);
      setName('');
      setEmail('');
      setSubject('');
      setMessage('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to send inquiry.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1000px] px-6 py-14 grid md:grid-cols-12 gap-10">
      <div className="md:col-span-5 space-y-5">
        <div className="text-xs font-medium text-blue-400">Customer Support</div>
        <h1 className="font-display text-3xl font-bold text-white">Contact Us</h1>
        <p className="text-sm text-zinc-400 leading-relaxed">
          {settings.supportNote ||
            `Need help with a pending top-up order or Player ID check? Reach out to the ${settings.storeName} team below.`}
        </p>

        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-5 space-y-4 text-sm">
          <div className="flex items-start gap-3">
            <Mail className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <div className="text-xs text-zinc-400">Support Email</div>
              <div className="font-medium text-white">{settings.supportEmail}</div>
            </div>
          </div>

          {settings.whatsappContact && (
            <div className="flex items-start gap-3">
              <MessageSquare
                className="h-4 w-4 text-blue-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <div className="text-xs text-zinc-400">WhatsApp Contact</div>
                <div className="font-mono text-white">{settings.whatsappContact}</div>
              </div>
            </div>
          )}

          <div className="flex items-start gap-3">
            <Clock className="h-4 w-4 text-zinc-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <div className="text-xs text-zinc-400">Support Hours</div>
              <div className="text-zinc-200">{settings.supportHours}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="md:col-span-7 bg-[#111118] border border-white/[0.08] rounded-xl p-6 sm:p-8">
        {submittedId ? (
          <div className="space-y-4 py-6">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-base">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              <span>Support Message Received</span>
            </div>
            <p className="text-sm text-zinc-300 leading-relaxed">
              Your inquiry has been logged with reference ID{' '}
              <span className="font-mono text-white">{submittedId}</span>.
            </p>
            <button
              type="button"
              onClick={() => setSubmittedId(null)}
              className="px-4 py-2 rounded-lg border border-white/[0.14] text-sm font-medium text-white hover:bg-white/[0.05]"
            >
              Send Another Message
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <h2 className="text-base font-semibold text-white">Send a Support Message</h2>

            {errorMsg && (
              <div
                role="alert"
                className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 text-sm text-red-200"
              >
                {errorMsg}
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="contact-name" className="block text-xs font-medium text-zinc-300">
                  Full Name
                </label>
                <input
                  id="contact-name"
                  type="text"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="contact-email" className="block text-xs font-medium text-zinc-300">
                  Email Address
                </label>
                <input
                  id="contact-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white focus:border-blue-500"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="contact-subject" className="block text-xs font-medium text-zinc-300">
                Subject
              </label>
              <input
                id="contact-subject"
                type="text"
                required
                minLength={3}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white focus:border-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="contact-message" className="block text-xs font-medium text-zinc-300">
                Message
              </label>
              <textarea
                id="contact-message"
                required
                minLength={10}
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white focus:border-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Sending...' : 'Submit Inquiry'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
