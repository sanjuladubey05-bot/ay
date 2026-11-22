import type { StoreGameSummary } from '../types/database';

export interface OrderReviewDraft {
  gameId: string;
  gameSlug: string;
  gameTitle: string;
  gameCoverImageUrl: string | null;
  gameDeliveryMode?: 'manual' | 'automatic' | 'hybrid';
  packageId: string;
  packageName: string;
  packageImageUrl: string | null;
  inGameAmount: number;
  inGameUnit: string;
  unitPriceInr: number;
  originalPriceInr?: number | null;
  discountPercent?: number;
  bonusBadge?: string;
  currencyCode: string;
  deliveryType?: 'manual' | 'automatic' | 'both';
  preferredDeliveryMethod?: 'manual' | 'automatic';
  idempotencyKey?: string;
  regionId: string | null;
  regionName: string | null;
  quantity: number;
  playerDetails: Record<string, string>;
  fieldLabels: Record<string, string>;
}

const DRAFT_STORAGE_KEY = 'lps_store_order_draft_v1';

export function saveOrderDraft(draft: OrderReviewDraft): void {
  try {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Ignore storage quota errors in restricted browsing contexts
  }
}

export function loadOrderDraft(): OrderReviewDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrderReviewDraft;
    if (!parsed?.packageId || !parsed?.gameSlug) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearOrderDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function formatInrPrice(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getStartingPriceLabel(game: StoreGameSummary): string {
  if (game.startingPriceInr === null) return 'Packages configuring';
  return `From ${formatInrPrice(game.startingPriceInr)}`;
}
