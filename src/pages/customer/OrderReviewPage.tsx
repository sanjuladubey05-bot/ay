import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock, ShieldCheck } from 'lucide-react';
import { ROUTES } from '../../configuration/routes';
import { useAuth } from '../../hooks/useAuth';
import { apiClient, ApiError } from '../../services/apiClient';
import {
  clearOrderDraft,
  formatInrPrice,
  loadOrderDraft,
  type OrderReviewDraft,
} from '../../utilities/orderDraft';

export function OrderReviewPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const stateDraft = (location.state as { orderDraft?: OrderReviewDraft } | null)?.orderDraft;
  const [draft, setDraft] = useState<OrderReviewDraft | null>(() => stateDraft || loadOrderDraft());
  const [customerNote, setCustomerNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (stateDraft) {
      setDraft(stateDraft);
    }
  }, [stateDraft]);

  async function handlePlaceOrder() {
    if (!draft || submitting) return;
    if (!user) {
      navigate(ROUTES.LOGIN, {
        state: { from: ROUTES.ORDER_REVIEW, orderDraft: draft },
      });
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.placePendingOrder({
        packageId: draft.packageId,
        regionId: draft.regionId || undefined,
        quantity: draft.quantity,
        playerDetails: draft.playerDetails,
        customerNote: customerNote.trim() || undefined,
        idempotencyKey: draft.idempotencyKey,
        preferredDeliveryMethod: draft.preferredDeliveryMethod,
      });
      clearOrderDraft();
      navigate(ROUTES.ORDERS, {
        replace: true,
        state: { justPlacedOrder: res },
      });
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        const firstFieldErr = Object.values(err.fieldErrors)[0];
        setErrorMsg(firstFieldErr || err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Unable to place order.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!draft) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-16">
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-10 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold text-white">No Order Selected</h1>
          <p className="text-sm text-zinc-400">
            Select a game, choose a top-up package, and enter your Player ID before reviewing your
            order.
          </p>
          <Link
            to={ROUTES.GAMES}
            className="inline-flex px-5 py-2.5 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
          >
            Browse All Games
          </Link>
        </div>
      </div>
    );
  }

  const finalAmount = draft.unitPriceInr * draft.quantity;

  return (
    <div className="mx-auto max-w-[920px] px-6 py-12 space-y-8">
      <div className="flex items-center justify-between">
        <Link
          to={`/games/${draft.gameSlug}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to {draft.gameTitle}</span>
        </Link>
        <div className="text-xs text-zinc-400">Order Review</div>
      </div>

      <div className="space-y-1.5">
        <h1 className="font-display text-3xl font-bold text-white">Review Your Order</h1>
        <p className="text-sm text-zinc-400">
          Confirm your game package, Player ID details, delivery workflow, and total amount before
          submitting your order.
        </p>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-200"
        >
          {errorMsg}
        </div>
      )}

      <div className="grid md:grid-cols-12 gap-6 items-start">
        <div className="md:col-span-7 space-y-6">
          {/* Game & Package Card */}
          <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-white border-b border-white/[0.06] pb-3">
              Selected Game &amp; Package
            </h2>
            <dl className="grid grid-cols-2 gap-y-3 text-sm">
              <dt className="text-zinc-400">Selected Game</dt>
              <dd className="text-right font-medium text-white">{draft.gameTitle}</dd>

              <dt className="text-zinc-400">Selected Package</dt>
              <dd className="text-right font-medium text-white flex items-center justify-end gap-2 flex-wrap">
                <span>{draft.packageName}</span>
                {draft.bonusBadge && (
                  <span className="rounded-md border border-blue-500/35 bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
                    {draft.bonusBadge}
                  </span>
                )}
              </dd>

              <dt className="text-zinc-400">Package Bundle</dt>
              <dd className="text-right font-mono tabular-nums text-zinc-200">
                {draft.inGameAmount.toLocaleString('en-IN')} {draft.inGameUnit}
              </dd>

              <dt className="text-zinc-400">Package Quantity</dt>
              <dd className="text-right font-mono tabular-nums text-white">{draft.quantity}</dd>

              <dt className="text-zinc-400">Delivery Method</dt>
              <dd className="text-right capitalize text-zinc-200">
                {draft.preferredDeliveryMethod || draft.deliveryType || 'manual'}
              </dd>

              {draft.regionName && (
                <>
                  <dt className="text-zinc-400">Server Region</dt>
                  <dd className="text-right text-zinc-200">{draft.regionName}</dd>
                </>
              )}
            </dl>
          </div>

          {/* Player Details Card */}
          <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <h2 className="text-sm font-semibold text-white">Player Information</h2>
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Verified Format
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-y-3 text-sm">
              {Object.entries(draft.playerDetails).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-zinc-400">{draft.fieldLabels[key] || key}</dt>
                  <dd className="text-right font-mono text-white break-all">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="pt-2 space-y-1.5">
              <label htmlFor="order-note" className="block text-xs font-medium text-zinc-400">
                Optional Note (Optional)
              </label>
              <input
                id="order-note"
                type="text"
                maxLength={200}
                value={customerNote}
                onChange={(e) => setCustomerNote(e.target.value)}
                placeholder="Any delivery timing note..."
                className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Summary & Place Order Column */}
        <div className="md:col-span-5 bg-[#111118] border border-white/[0.08] rounded-xl p-6 space-y-5">
          <h2 className="text-sm font-semibold text-white border-b border-white/[0.06] pb-3">
            Order Summary
          </h2>

          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-zinc-400">Package Price</dt>
              <dd className="font-mono tabular-nums text-zinc-200">
                {formatInrPrice(draft.unitPriceInr)}
                {draft.originalPriceInr && (draft.discountPercent || 0) > 0 && (
                  <span className="ml-2 text-xs text-zinc-500 line-through">
                    {formatInrPrice(draft.originalPriceInr)}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-zinc-400">Quantity</dt>
              <dd className="font-mono tabular-nums text-zinc-200">× {draft.quantity}</dd>
            </div>
            <div className="pt-3 border-t border-white/[0.08] flex items-center justify-between">
              <dt className="font-semibold text-white">Final Order Amount</dt>
              <dd className="font-mono tabular-nums text-xl font-bold text-white">
                {formatInrPrice(finalAmount)}
              </dd>
            </div>
          </dl>

          <div className="rounded-lg bg-blue-500/10 border border-blue-500/25 p-3.5 flex items-start gap-2.5 text-xs text-blue-200 leading-relaxed">
            <Clock className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <div className="font-semibold text-white">Payment Pending (Unpaid)</div>
              <p className="mt-0.5 text-blue-200/80">
                Payment options will be available soon. Submitting places your order safely without
                collecting online payment yet.
              </p>
            </div>
          </div>

          {!user ? (
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => void handlePlaceOrder()}
                className="w-full py-3 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
              >
                Sign In to Place Order
              </button>
              <p className="text-xs text-zinc-400 text-center">
                Your selected package and Player ID details stay saved while you sign in.
              </p>
            </div>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handlePlaceOrder()}
              className="w-full py-3 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <span>{submitting ? 'Placing Order...' : 'Place Order'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
