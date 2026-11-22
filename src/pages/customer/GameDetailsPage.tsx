import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Gamepad2,
  Minus,
  Package as PackageIcon,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { ROUTES } from '../../configuration/routes';
import { apiClient } from '../../services/apiClient';
import type { StoreGameDetail, StorePackageItem } from '../../types/database';
import { formatInrPrice, saveOrderDraft } from '../../utilities/orderDraft';
import { sanitizeAndValidatePlayerFields } from '../../utilities/playerFields';

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `lps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function GameDetailsPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [game, setGame] = useState<StoreGameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  const [selectedCurrencyFilter, setSelectedCurrencyFilter] = useState<string>('all');
  const [selectedPackage, setSelectedPackage] = useState<StorePackageItem | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string>('');
  const [preferredDeliveryMethod, setPreferredDeliveryMethod] = useState<'manual' | 'automatic'>(
    'manual'
  );
  const [quantity, setQuantity] = useState(1);
  const [playerValues, setPlayerValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formBannerError, setFormBannerError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let active = true;
    setLoading(true);
    setErrorMsg(null);
    setSelectedCurrencyFilter('all');
    setSelectedPackage(null);
    setPlayerValues({});
    setFieldErrors({});
    setFormBannerError(null);

    apiClient
      .getStoreGameBySlug(slug)
      .then((res) => {
        if (!active) return;
        setGame(res.game);
        setPreferredDeliveryMethod(res.game.deliveryMode === 'automatic' ? 'automatic' : 'manual');
        if (res.game.regions.length > 0) {
          setSelectedRegionId(res.game.regions[0].id);
        } else {
          setSelectedRegionId('');
        }
      })
      .catch((err) => {
        if (active) {
          setErrorMsg(err instanceof Error ? err.message : 'Game could not be loaded.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug]);

  function handleFieldChange(key: string, value: string) {
    setPlayerValues((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    setFormBannerError(null);
  }

  function handleReviewOrder(e: FormEvent) {
    e.preventDefault();
    if (!game || !selectedPackage) return;

    const validation = sanitizeAndValidatePlayerFields(game.playerFields, playerValues);
    if (!validation.valid) {
      setFieldErrors(validation.errors);
      setFormBannerError('Please complete all required player details before reviewing your order.');
      return;
    }

    const regionObj = game.regions.find((r) => r.id === selectedRegionId) || null;
    const fieldLabels: Record<string, string> = {};
    for (const field of game.playerFields) {
      fieldLabels[field.key] = field.label;
    }

    const supportsBoth =
      selectedPackage.deliveryType === 'both' || game.deliveryMode === 'hybrid';
    const resolvedPref: 'manual' | 'automatic' = supportsBoth
      ? preferredDeliveryMethod
      : selectedPackage.deliveryType === 'automatic' || game.deliveryMode === 'automatic'
        ? 'automatic'
        : 'manual';

    const draft = {
      gameId: game.id,
      gameSlug: game.slug,
      gameTitle: game.title,
      gameCoverImageUrl: game.coverImageUrl,
      gameDeliveryMode: game.deliveryMode,
      packageId: selectedPackage.id,
      packageName: selectedPackage.name,
      packageImageUrl: selectedPackage.imageUrl,
      inGameAmount: selectedPackage.inGameAmount,
      inGameUnit: selectedPackage.inGameUnit,
      unitPriceInr: selectedPackage.priceInr,
      originalPriceInr: selectedPackage.originalPriceInr,
      discountPercent: selectedPackage.discountPercent,
      bonusBadge: selectedPackage.bonusBadge || undefined,
      currencyCode: selectedPackage.currencyCode || 'INR',
      deliveryType: selectedPackage.deliveryType,
      preferredDeliveryMethod: resolvedPref,
      idempotencyKey: createIdempotencyKey(),
      regionId: regionObj?.id || null,
      regionName: regionObj?.regionName || null,
      quantity,
      playerDetails: validation.sanitizedDetails,
      fieldLabels,
    };

    saveOrderDraft(draft);
    navigate(ROUTES.ORDER_REVIEW, { state: { orderDraft: draft } });
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-14 space-y-6">
        <div className="h-44 rounded-xl bg-[#111118] border border-white/[0.08] animate-pulse" />
        <div className="grid sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-36 rounded-xl bg-[#111118] border border-white/[0.08] animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (errorMsg || !game) {
    return (
      <div className="mx-auto max-w-[760px] px-6 py-16">
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-10 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold text-white">Game Unavailable</h1>
          <p className="text-sm text-zinc-400">
            {errorMsg || 'This game is either unavailable or disabled by the administrator.'}
          </p>
          <Link
            to={ROUTES.GAMES}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back to All Games</span>
          </Link>
        </div>
      </div>
    );
  }

  const effectiveFields =
    game.playerFields.length > 0
      ? game.playerFields
      : [
          {
            key: 'player_id',
            label: 'Player ID',
            type: 'text' as const,
            placeholder: 'Enter your Player ID',
            required: true,
          },
        ];

  const visiblePackages =
    selectedCurrencyFilter === 'all'
      ? game.packages
      : game.packages.filter((p) => p.gameCurrencyId === selectedCurrencyFilter);

  const supportsChoice =
    selectedPackage !== null &&
    (selectedPackage.deliveryType === 'both' || game.deliveryMode === 'hybrid');

  const totalPreviewInr = selectedPackage ? selectedPackage.priceInr * quantity : 0;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12 space-y-10">
      <div>
        <Link
          to={ROUTES.GAMES}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to All Games</span>
        </Link>
      </div>

      {/* Game Header */}
      <section className="bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden grid md:grid-cols-12 items-stretch">
        <div className="md:col-span-4 bg-[#0D0D14] min-h-[200px]">
          {game.coverImageUrl && !heroImgFailed ? (
            <img
              src={game.coverImageUrl}
              alt={game.title}
              referrerPolicy="no-referrer"
              onError={() => setHeroImgFailed(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full min-h-[200px] flex items-center justify-center bg-[#0D0D14]">
              <Gamepad2 className="h-10 w-10 text-violet-400" aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="md:col-span-8 p-6 sm:p-8 flex flex-col justify-between gap-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
              <span className="font-medium text-blue-400">{game.category}</span>
              <span>·</span>
              <span>{game.publisher}</span>
              <span>·</span>
              <span className="capitalize">
                Delivery: {game.deliveryMode === 'hybrid' ? 'Manual & Auto' : game.deliveryMode}
              </span>
            </div>
            <h1 className="font-display text-3xl font-bold text-white">{game.title}</h1>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-2xl">{game.description}</p>
          </div>

          <div className="pt-4 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="text-zinc-400">
              {game.gameCurrencies.length > 0 ? (
                <>
                  In-Game Currencies:{' '}
                  <span className="font-medium text-zinc-100">
                    {game.gameCurrencies.map((c) => c.name).join(' · ')}
                  </span>
                </>
              ) : (
                <>
                  Settlement:{' '}
                  <span className="font-medium text-zinc-100">
                    {game.currencies.map((c) => `${c.code} (${c.symbol})`).join(' · ')}
                  </span>
                </>
              )}
            </div>
            <div className="inline-flex items-center gap-1.5 text-emerald-400">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span>Player ID Only · No Password Needed</span>
            </div>
          </div>
        </div>
      </section>

      {/* Step 1: Packages Grid */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <div className="text-xs font-medium text-blue-400">Step 1</div>
            <h2 className="font-display text-xl font-bold text-white">Select Top-Up Package</h2>
          </div>
          {selectedPackage && (
            <div className="text-xs text-zinc-300">
              Selected:{' '}
              <span className="font-semibold text-white">{selectedPackage.name}</span> (
              <span className="font-mono tabular-nums text-violet-300">
                {formatInrPrice(selectedPackage.priceInr)}
              </span>
              )
            </div>
          )}
        </div>

        {game.gameCurrencies.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedCurrencyFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selectedCurrencyFilter === 'all'
                  ? 'bg-violet-600 text-white'
                  : 'bg-[#111118] border border-white/[0.1] text-zinc-300 hover:text-white'
              }`}
            >
              All Currencies
            </button>
            {game.gameCurrencies.map((curr) => (
              <button
                key={curr.id}
                type="button"
                onClick={() => setSelectedCurrencyFilter(curr.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  selectedCurrencyFilter === curr.id
                    ? 'bg-violet-600 text-white'
                    : 'bg-[#111118] border border-white/[0.1] text-zinc-300 hover:text-white'
                }`}
              >
                {curr.name}
              </button>
            ))}
          </div>
        )}

        {visiblePackages.length === 0 ? (
          <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-8 text-center text-sm text-zinc-400">
            No active packages are configured for this currency selection yet.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visiblePackages.map((pkg) => {
              const isSelected = selectedPackage?.id === pkg.id;
              return (
                <PackageCard
                  key={pkg.id}
                  pkg={pkg}
                  fallbackImageUrl={game.coverImageUrl}
                  isSelected={isSelected}
                  onSelect={() => {
                    setSelectedPackage(pkg);
                    setFormBannerError(null);
                  }}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* Step 2: Dynamic Player Information Form */}
      {selectedPackage && (
        <section
          aria-label="Player Information Form"
          className="bg-[#111118] border border-violet-500/30 rounded-xl p-6 sm:p-8 space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
            <div>
              <div className="text-xs font-medium text-blue-400">Step 2</div>
              <h2 className="font-display text-xl font-bold text-white">
                Enter Player Information
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Never share your game password or OTP — LPS STORE only collects public Player /
                Server IDs.
              </p>
            </div>

            <div className="bg-[#09090E] border border-white/[0.08] rounded-lg px-4 py-2.5 text-right">
              <div className="text-xs text-zinc-400">Selected Package</div>
              <div className="text-sm font-semibold text-white">{selectedPackage.name}</div>
              <div className="font-mono tabular-nums text-xs text-violet-300">
                {formatInrPrice(selectedPackage.priceInr)} × {quantity} ={' '}
                {formatInrPrice(totalPreviewInr)}
              </div>
            </div>
          </div>

          {formBannerError && (
            <div
              role="alert"
              className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 text-sm text-red-200"
            >
              {formBannerError}
            </div>
          )}

          <form onSubmit={handleReviewOrder} className="space-y-5">
            <div className="grid sm:grid-cols-3 gap-5">
              {game.regions.length > 0 && (
                <div className="space-y-1.5">
                  <label htmlFor="game-region" className="block text-xs font-medium text-zinc-300">
                    Server Region <span className="text-red-400">*</span>
                  </label>
                  <select
                    id="game-region"
                    value={selectedRegionId}
                    onChange={(e) => setSelectedRegionId(e.target.value)}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white focus:border-blue-500"
                  >
                    {game.regions.map((reg) => (
                      <option key={reg.id} value={reg.id}>
                        {reg.regionName}
                        {reg.serverHint ? ` — ${reg.serverHint}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-zinc-300">Package Quantity</span>
                <div className="inline-flex items-center rounded-lg bg-[#09090E] border border-white/[0.14]">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="px-3 py-2.5 text-zinc-300 hover:text-white disabled:opacity-40"
                    disabled={quantity <= 1}
                  >
                    <Minus className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <span className="px-4 font-mono tabular-nums text-sm font-semibold text-white">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    onClick={() => setQuantity((q) => Math.min(10, q + 1))}
                    className="px-3 py-2.5 text-zinc-300 hover:text-white disabled:opacity-40"
                    disabled={quantity >= 10}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {supportsChoice && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="delivery-preference"
                    className="block text-xs font-medium text-zinc-300"
                  >
                    Delivery Mode Preference
                  </label>
                  <select
                    id="delivery-preference"
                    value={preferredDeliveryMethod}
                    onChange={(e) =>
                      setPreferredDeliveryMethod(e.target.value as 'manual' | 'automatic')
                    }
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white focus:border-blue-500"
                  >
                    <option value="manual">Manual Desk Processing</option>
                    <option value="automatic">Automatic Queue (API Ready)</option>
                  </select>
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-5">
              {effectiveFields.map((field) => {
                const val = playerValues[field.key] ?? '';
                const err = fieldErrors[field.key];
                const inputId = `player-field-${field.key}`;
                return (
                  <div key={field.key} className="space-y-1.5">
                    <label htmlFor={inputId} className="block text-xs font-medium text-zinc-300">
                      {field.label}{' '}
                      {field.required && <span className="text-red-400">*</span>}
                    </label>
                    {field.type === 'select' && field.options && field.options.length > 0 ? (
                      <select
                        id={inputId}
                        value={val}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                        aria-invalid={Boolean(err)}
                        className={`w-full rounded-lg bg-[#09090E] border px-3.5 py-2.5 text-sm text-white focus:border-blue-500 ${
                          err ? 'border-red-500/70' : 'border-white/[0.14]'
                        }`}
                      >
                        <option value="">Select {field.label}</option>
                        {field.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={inputId}
                        type="text"
                        value={val}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                        placeholder={field.placeholder || `Enter ${field.label}`}
                        aria-invalid={Boolean(err)}
                        className={`w-full rounded-lg bg-[#09090E] border px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 ${
                          err ? 'border-red-500/70' : 'border-white/[0.14]'
                        }`}
                      />
                    )}
                    {err ? (
                      <p className="text-xs text-red-400" role="alert">
                        {err}
                      </p>
                    ) : field.hint ? (
                      <p className="text-xs text-zinc-500">{field.hint}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="text-sm text-zinc-300">
                Total Order Amount:{' '}
                <span className="font-mono tabular-nums text-lg font-bold text-white">
                  {formatInrPrice(totalPreviewInr)}
                </span>
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors whitespace-nowrap"
              >
                <span>Review Order</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

function PackageCard({
  pkg,
  fallbackImageUrl,
  isSelected,
  onSelect,
}: {
  pkg: StorePackageItem;
  fallbackImageUrl: string | null;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const imageSrc = pkg.imageUrl || pkg.gameCurrencyImageUrl || fallbackImageUrl;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={`text-left rounded-xl border p-4 transition-all flex items-center gap-4 ${
        isSelected
          ? 'bg-violet-600/12 border-violet-500 ring-1 ring-violet-500/50'
          : 'bg-[#111118] border-white/[0.08] hover:border-white/[0.2]'
      }`}
    >
      <div className="h-16 w-16 rounded-lg overflow-hidden bg-[#09090E] border border-white/[0.08] shrink-0 flex items-center justify-center">
        {imageSrc && !imgFailed ? (
          <img
            src={imageSrc}
            alt={pkg.name}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <PackageIcon className="h-6 w-6 text-violet-400" aria-hidden="true" />
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium text-sm text-white truncate">{pkg.name}</div>
          {isSelected && (
            <span className="h-5 w-5 rounded-md bg-violet-600 text-white flex items-center justify-center shrink-0">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-zinc-400 font-mono tabular-nums">
            {pkg.inGameAmount.toLocaleString('en-IN')} {pkg.inGameUnit}
          </span>
          {pkg.bonusBadge && (
            <span className="rounded-md border border-blue-500/35 bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
              {pkg.bonusBadge}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2 pt-0.5 flex-wrap">
          <span className="font-mono tabular-nums text-base font-bold text-white">
            {formatInrPrice(pkg.priceInr)}
          </span>
          {pkg.originalPriceInr && pkg.discountPercent > 0 && (
            <>
              <span className="font-mono tabular-nums text-xs text-zinc-500 line-through">
                {formatInrPrice(pkg.originalPriceInr)}
              </span>
              <span className="font-mono text-[11px] font-semibold text-emerald-400">
                {pkg.discountPercent}% OFF
              </span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
