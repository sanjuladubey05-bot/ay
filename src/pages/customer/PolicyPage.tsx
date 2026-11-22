import { Link } from 'react-router-dom';
import { ROUTES } from '../../configuration/routes';

type PolicyType = 'terms' | 'privacy' | 'refund';

const POLICY_CONTENT: Record<
  PolicyType,
  { title: string; subtitle: string; sections: { heading: string; body: string }[] }
> = {
  terms: {
    title: 'Terms and Conditions',
    subtitle: 'Storefront ordering rules and account safety terms for LPS STORE.',
    sections: [
      {
        heading: '1. Digital Top-Up Services',
        body: 'LPS STORE processes digital in-game currency top-ups strictly using public Player IDs, User IDs, and server region selections. We never ask for game passwords, PINs, or one-time passcodes.',
      },
      {
        heading: '2. Player Details Accuracy',
        body: 'Customers are responsible for verifying their Player ID and server region prior to submitting an order on the Order Review page.',
      },
      {
        heading: '3. Order & Payment Availability',
        body: 'Orders placed during the current release are recorded safely in Pending status while online payment options are prepared. Payment options will be available soon.',
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    subtitle: 'How LPS STORE collects, stores, and isolates customer data.',
    sections: [
      {
        heading: '1. Data We Collect',
        body: 'We store your registration email, name, optional phone number, and public in-game identifiers required to fulfill your top-up orders.',
      },
      {
        heading: '2. Strict Credential Prohibition',
        body: 'LPS STORE strictly prohibits collecting third-party game account passwords or OTP verification codes.',
      },
      {
        heading: '3. Account Isolation',
        body: 'Customer order history and profile records are protected by session-backed authentication and PostgreSQL Row Level Security.',
      },
    ],
  },
  refund: {
    title: 'Refund Policy',
    subtitle: 'Eligibility and review guidelines for digital top-up orders.',
    sections: [
      {
        heading: '1. Pending Unpaid Orders',
        body: 'Orders placed in Pending status prior to payment gateway activation carry zero financial charge and can be reviewed with customer support.',
      },
      {
        heading: '2. Delivered Digital Top-Ups',
        body: 'Once digital currency is delivered to the verified Player ID submitted on an order, digital top-ups are non-reversible.',
      },
      {
        heading: '3. Failed Deliveries',
        body: 'If a confirmed top-up fails due to a technical delivery error, our support team will assist with re-processing or eligible refund review.',
      },
    ],
  },
};

export function PolicyPage({ type }: { type: PolicyType }) {
  const doc = POLICY_CONTENT[type];

  return (
    <div className="mx-auto max-w-[840px] px-6 py-14 space-y-8">
      <div className="border-b border-white/[0.08] pb-6 space-y-2">
        <div className="text-xs font-medium text-blue-400">LPS STORE Policy</div>
        <h1 className="font-display text-3xl font-bold text-white">{doc.title}</h1>
        <p className="text-sm text-zinc-400">{doc.subtitle}</p>
      </div>

      <div className="space-y-6">
        {doc.sections.map((section) => (
          <section
            key={section.heading}
            className="bg-[#111118] border border-white/[0.08] rounded-xl p-6 space-y-2"
          >
            <h2 className="text-base font-semibold text-white">{section.heading}</h2>
            <p className="text-sm text-zinc-400 leading-relaxed">{section.body}</p>
          </section>
        ))}
      </div>

      <div className="pt-2 flex flex-wrap gap-4 text-xs text-zinc-400">
        <Link to={ROUTES.CONTACT} className="text-violet-400 hover:text-violet-300">
          Contact Support
        </Link>
        <Link to={ROUTES.GAMES} className="hover:text-white">
          Browse All Games
        </Link>
      </div>
    </div>
  );
}
