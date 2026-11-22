import { useEffect, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { GameCard } from '../../components/GameCard';
import { apiClient } from '../../services/apiClient';
import type { StoreGameSummary } from '../../types/database';

export function GamesPage() {
  const [games, setGames] = useState<StoreGameSummary[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 180);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg(null);
    apiClient
      .getStoreGames({
        search: debouncedSearch || undefined,
        category: selectedCategory !== 'all' ? selectedCategory : undefined,
      })
      .then((res) => {
        if (!active) return;
        setGames(res.games);
        if (res.categories.length > 0 || selectedCategory === 'all') {
          setCategories(res.categories);
        }
      })
      .catch((err) => {
        if (active) {
          setErrorMsg(err instanceof Error ? err.message : 'Unable to load games catalog.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [debouncedSearch, selectedCategory]);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-14 space-y-8">
      <div className="border-b border-white/[0.08] pb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-blue-400">Active Storefront Catalog</div>
          <h1 className="font-display text-3xl font-bold text-white">All Games</h1>
          <p className="text-sm text-zinc-400 max-w-xl">
            Browse all admin-enabled games and select a title to inspect live packages and
            top-up pricing.
          </p>
        </div>

        <div className="w-full lg:w-80 relative">
          <Search
            className="h-4 w-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <label htmlFor="games-search" className="sr-only">
            Search games
          </label>
          <input
            id="games-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search games or publishers..."
            className="w-full rounded-lg bg-[#111118] border border-white/[0.12] pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500"
          />
        </div>
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by game category">
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400 mr-2">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Category:</span>
          </span>
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              selectedCategory === 'all'
                ? 'bg-violet-600 text-white'
                : 'bg-[#111118] border border-white/[0.1] text-zinc-300 hover:text-white'
            }`}
          >
            All Games
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-violet-600 text-white'
                  : 'bg-[#111118] border border-white/[0.1] text-zinc-300 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((slot) => (
            <div
              key={slot}
              className="bg-[#111118] border border-white/[0.08] rounded-xl h-72 animate-pulse"
            />
          ))}
        </div>
      ) : errorMsg ? (
        <div
          role="alert"
          className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-sm text-red-200"
        >
          {errorMsg}
        </div>
      ) : games.length === 0 ? (
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-12 text-center space-y-3">
          <h2 className="text-base font-semibold text-white">No Matching Active Games</h2>
          <p className="text-sm text-zinc-400 max-w-md mx-auto">
            {debouncedSearch || selectedCategory !== 'all'
              ? 'No active games match your current search or category filter.'
              : 'There are currently no active games enabled by the store administrator.'}
          </p>
          {(debouncedSearch || selectedCategory !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setSelectedCategory('all');
              }}
              className="px-4 py-2 rounded-lg border border-white/[0.14] text-xs font-medium text-white hover:bg-white/[0.06]"
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      )}
    </div>
  );
}
