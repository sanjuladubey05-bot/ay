import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ClipboardCheck,
  Gamepad2,
  Headphones,
  ListChecks,
  ShieldCheck,
  Tag,
} from 'lucide-react';
import { GameCard } from '../../components/GameCard';
import { ROUTES } from '../../configuration/routes';
import { useStorefrontSettings } from '../../hooks/useStorefrontSettings';
import { apiClient } from '../../services/apiClient';
import type { StoreGameSummary } from '../../types/database';

const WHY_CHOOSE_ITEMS = [
  {
    icon: ListChecks,
    accentClass: 'bg-violet-600/15 text-violet-400',
    title: 'Easy Ordering',
    description:
      'Pick your game, choose a top-up pack, and enter only the required Player ID and server details.',
  },
  {
    icon: Tag,
    accentClass: 'bg-blue-600/15 text-blue-400',
    title: 'Clear Package Prices',
    description:
      'Every package amount and rupee price is fetched live from our store catalog with zero hidden fees.',
  },
  {
    icon: ClipboardCheck,
    accentClass: 'bg-violet-600/15 text-violet-400',
    title: 'Order Tracking',
    description:
      'Follow every top-up from Pending and Processing through Delivered in your authenticated order history.',
  },
  {
    icon: Headphones,
    accentClass: 'bg-blue-600/15 text-blue-400',
    title: 'Customer Support',
    description:
      'Dedicated support assistance without ever requesting your game password or account OTP.',
  },
];

const HOW_IT_WORKS_STEPS = [
  { step: '01', title: 'Select your game', detail: 'Browse supported titles in our live catalog.' },
  { step: '02', title: 'Choose a package', detail: 'Pick the exact currency bundle and quantity.' },
  {
    step: '03',
    title: 'Enter the required Player ID and server details',
    detail: 'Provide only public in-game identifiers — never passwords or OTPs.',
  },
  {
    step: '04',
    title: 'Submit your order',
    detail: 'Review your summary and confirm your order cleanly.',
  },
  {
    step: '05',
    title: 'Track your order status',
    detail: 'Check live order and delivery updates in My Orders.',
  },
];

export function HomePage() {
  const { settings } = useStorefrontSettings();
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [popularGames, setPopularGames] = useState<StoreGameSummary[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [gamesError, setGamesError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingGames(true);
    apiClient
      .getStoreGames({ featured: true })
      .then(async (res) => {
        if (!active) return;
        if (res.games.length > 0) {
          setPopularGames(res.games);
        } else {
          const fallback = await apiClient.getStoreGames();
          if (active) setPopularGames(fallback.games.slice(0, 4));
        }
      })
      .catch((err) => {
        if (active) {
          setGamesError(err instanceof Error ? err.message : 'Could not load popular games.');
        }
      })
      .finally(() => {
        if (active) setLoadingGames(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      {/* A. Hero Section */}
      <section className="relative border-b border-white/[0.08] overflow-hidden">
        <div className="mx-auto max-w-[1200px] px-6 py-16 lg:py-24 grid lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-6 space-y-6">
            <div className="text-xs font-semibold uppercase tracking-widest text-blue-400">
              {settings.storeName} · Official Game Top-Ups
            </div>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.05] [text-wrap:balance]">
              {settings.heroHeading}
            </h1>
            <p className="text-lg text-zinc-300 font-medium">
              {settings.heroSubtitle}
            </p>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-xl">
              Top up your favourite titles with transparent rupee pricing, dynamic Player ID
              checks, and real-time order tracking — without ever sharing a password or OTP.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <Link
                to={ROUTES.GAMES}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors whitespace-nowrap"
              >
                <span>Explore Games</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                to={ROUTES.ORDERS}
                className="inline-flex items-center px-5 py-3 rounded-lg border border-white/[0.14] text-sm font-medium text-zinc-200 hover:bg-white/[0.05] transition-colors whitespace-nowrap"
              >
                Track My Orders
              </Link>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="relative aspect-[16/10] rounded-xl overflow-hidden border border-white/[0.1] bg-[#111118]">
              {!heroImgFailed ? (
                <img
                  src="/src/assets/images/hero_gaming_vault_1795267139237.jpg"
                  alt="LPS STORE obsidian gaming top-up showcase"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#161626] to-[#09090E] gap-3 p-8">
                  <Gamepad2 className="h-12 w-12 text-violet-400" aria-hidden="true" />
                  <div className="font-display text-lg font-semibold text-white">LPS STORE</div>
                </div>
              )}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#09090E]/75 via-transparent to-transparent"
              />
              <div className="absolute bottom-3.5 left-4 right-4 flex items-center justify-between gap-2 text-[11px] sm:text-xs text-zinc-300">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <ShieldCheck className="h-3.5 w-3.5 text-blue-400 shrink-0" aria-hidden="true" />
                  Player ID Only · Never Passwords
                </span>
                <span className="font-mono text-zinc-400 whitespace-nowrap shrink-0">INR Store</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* B. Popular Games */}
      <section className="border-b border-white/[0.08]">
        <div className="mx-auto max-w-[1200px] px-6 py-16 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-blue-400">Live Catalog</div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
                Popular Games
              </h2>
            </div>
            <Link
              to={ROUTES.GAMES}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-400 hover:text-violet-300 transition-colors whitespace-nowrap"
            >
              <span>View All Games</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {loadingGames ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((slot) => (
                <div
                  key={slot}
                  className="bg-[#111118] border border-white/[0.08] rounded-xl h-72 animate-pulse"
                />
              ))}
            </div>
          ) : gamesError ? (
            <div
              role="alert"
              className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-sm text-red-200"
            >
              {gamesError}
            </div>
          ) : popularGames.length === 0 ? (
            <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-10 text-center space-y-2">
              <h3 className="text-base font-semibold text-white">No Active Games Published</h3>
              <p className="text-sm text-zinc-400">
                Games enabled by the store administrator appear here automatically.
              </p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {popularGames.map((game) => (
                <GameCard key={game.id} game={game} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* C. Why Choose LPS STORE? */}
      <section className="border-b border-white/[0.08]">
        <div className="mx-auto max-w-[1200px] px-6 py-16 space-y-8">
          <div className="space-y-1.5 max-w-2xl">
            <div className="text-xs font-medium text-blue-400">Storefront Standards</div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
              Why Choose LPS STORE?
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {WHY_CHOOSE_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="bg-[#111118] border border-white/[0.08] rounded-xl p-6 space-y-3"
                >
                  <div
                    className={`h-10 w-10 rounded-lg flex items-center justify-center ${item.accentClass}`}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="text-base font-semibold text-white">{item.title}</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">{item.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* D. How It Works */}
      <section className="mx-auto max-w-[1200px] px-6 py-16 space-y-8">
        <div className="space-y-1.5 max-w-2xl">
          <div className="text-xs font-medium text-blue-400">Simple 5-Step Flow</div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
            How It Works
          </h2>
        </div>

        <ol className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {HOW_IT_WORKS_STEPS.map((item) => (
            <li
              key={item.step}
              className="bg-[#111118] border border-white/[0.08] rounded-xl p-5 space-y-2.5"
            >
              <div className="font-mono text-xs font-semibold text-violet-400">
                STEP {item.step}
              </div>
              <h3 className="text-sm font-semibold text-white leading-snug">{item.title}</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">{item.detail}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
