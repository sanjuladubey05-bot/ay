import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Gamepad2 } from 'lucide-react';
import type { StoreGameSummary } from '../types/database';
import { getStartingPriceLabel } from '../utilities/orderDraft';

export function GameCard({ game }: { game: StoreGameSummary }) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <article className="group bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-500/40">
      <div className="relative aspect-[4/3] w-full bg-[#0D0D14] overflow-hidden">
        {game.coverImageUrl && !imgFailed ? (
          <img
            src={game.coverImageUrl}
            alt={game.title}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#171724] to-[#0D0D14] text-zinc-500 gap-2">
            <Gamepad2 className="h-8 w-8 text-violet-400" aria-hidden="true" />
            <span className="text-xs font-medium text-zinc-400">{game.title}</span>
          </div>
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#111118]/80 via-transparent to-transparent"
        />
      </div>

      <div className="p-5 flex-1 flex flex-col justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
            <span className="font-medium text-blue-400">{game.category}</span>
            <span>{game.publisher}</span>
          </div>
          <h3 className="font-display text-lg font-semibold text-white">{game.title}</h3>
          <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
            {game.description}
          </p>
        </div>

        <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-3">
          <div className="text-xs">
            <span className="font-mono tabular-nums font-semibold text-zinc-100">
              {getStartingPriceLabel(game)}
            </span>
          </div>
          <Link
            to={`/games/${game.slug}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 transition-colors whitespace-nowrap shrink-0"
          >
            <span>View Packages</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
