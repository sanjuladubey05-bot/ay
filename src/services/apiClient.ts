import type {
  AdminCurrencyItem,
  AdminCustomerItem,
  AdminGameItem,
  AdminMediaItem,
  AdminOrderItem,
  AdminOverviewResponse,
  AdminPackageItem,
  AdminProfileResponse,
  AdminRegionItem,
  AdminSettingsResponse,
  AdminSupplierItem,
  AuthStatusResponse,
  AuthenticatedUser,
  CustomerOrderItemView,
  CustomerProfileResponse,
  PlaceOrderRequest,
  PlaceOrderResponse,
  StoreGameDetailResponse,
  StoreGamesListResponse,
  StorefrontIdentitySettings,
  SupplierOrderItem,
  SupplierPackageMappingItem,
} from '../types/api';
import type {
  ChecklistItemState,
  ChecklistStatus,
  PaymentMode,
  PlayerFieldDefinition,
} from '../types/database';

export class ApiError extends Error {
  status: number;
  code: string;
  blockers?: string[];
  fieldErrors?: Record<string, string>;

  constructor(
    message: string,
    status: number,
    code = 'API_ERROR',
    blockers?: string[],
    fieldErrors?: Record<string, string>
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.blockers = blockers;
    this.fieldErrors = fieldErrors;
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-Requested-With', 'LPS-Store-Client');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers,
  });

  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    blockers?: string[];
    fieldErrors?: Record<string, string>;
  };

  if (!response.ok) {
    throw new ApiError(
      data.error || `Request failed (${response.status})`,
      response.status,
      data.code || 'API_ERROR',
      data.blockers,
      data.fieldErrors
    );
  }

  return data as T;
}

export const apiClient = {
  getAuthStatus: () => request<AuthStatusResponse>('/api/auth/status'),

  bootstrapOwnerAdmin: (payload: { email: string; fullName: string; password: string }) =>
    request<{ message: string; user: AuthenticatedUser }>('/api/auth/admin/bootstrap', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminLogin: (payload: { email: string; password: string }) =>
    request<{ user: AuthenticatedUser }>('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  customerLogin: (payload: { email: string; password: string }) =>
    request<{ user: AuthenticatedUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  customerRegister: (payload: { email: string; fullName: string; password: string }) =>
    request<{ user: AuthenticatedUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  firebaseLogin: (idToken: string) =>
    request<{ user: AuthenticatedUser }>('/api/auth/firebase', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    }),

  logout: () =>
    request<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),

  requestPasswordReset: (email: string) =>
    request<{ message: string }>('/api/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  getStoreFoundation: () =>
    request<{
      publicSettings: Record<string, unknown>;
      currencies: { code: string; name: string; symbol: string }[];
      activeGamesCount: number;
    }>('/api/store/foundation'),

  getStoreGames: (params?: { search?: string; category?: string; featured?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.category && params.category !== 'all') qs.set('category', params.category);
    if (params?.featured) qs.set('featured', 'true');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<StoreGamesListResponse>(`/api/store/games${suffix}`);
  },

  getStoreGameBySlug: (slug: string) =>
    request<StoreGameDetailResponse>(`/api/store/games/${encodeURIComponent(slug)}`),

  placePendingOrder: (payload: PlaceOrderRequest) =>
    request<PlaceOrderResponse>('/api/orders/place', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getCustomerOrders: () =>
    request<{ orders: CustomerOrderItemView[] }>('/api/customer/orders'),

  getCustomerProfile: () => request<CustomerProfileResponse>('/api/customer/profile'),

  updateCustomerProfile: (payload: { fullName: string; phone?: string | null }) =>
    request<{ ok: boolean; fullName: string; phone: string | null }>('/api/customer/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  submitContactInquiry: (payload: {
    name: string;
    email: string;
    subject: string;
    message: string;
  }) =>
    request<{ id: string; createdAt: string; message: string }>('/api/contact', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /* ---------------------- Phase 3 Admin Endpoints ---------------------- */

  getAdminOverview: () => request<AdminOverviewResponse>('/api/admin/overview'),

  getAdminGames: (params?: { search?: string; category?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.category && params.category !== 'all') qs.set('category', params.category);
    if (params?.status && params.status !== 'all') qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ games: AdminGameItem[]; categories: string[] }>(
      `/api/admin/catalog/games${suffix}`
    );
  },

  createAdminGame: (payload: {
    slug: string;
    title: string;
    publisher?: string;
    category: string;
    description?: string;
    coverImageUrl?: string | null;
    coverMediaId?: string | null;
    deliveryMode?: 'manual' | 'automatic' | 'hybrid';
    defaultSupplierId?: string | null;
    isActive?: boolean;
    isFeatured?: boolean;
    sortOrder?: number;
    playerFields?: PlayerFieldDefinition[];
  }) =>
    request<{ game: { id: string; slug: string; title: string } }>('/api/admin/catalog/games', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAdminGame: (
    id: string,
    payload: Partial<{
      slug: string;
      title: string;
      publisher: string;
      category: string;
      description: string;
      coverImageUrl: string | null;
      coverMediaId: string | null;
      deliveryMode: 'manual' | 'automatic' | 'hybrid';
      defaultSupplierId: string | null;
      isActive: boolean;
      isFeatured: boolean;
      sortOrder: number;
      playerFields: PlayerFieldDefinition[];
    }>
  ) =>
    request<{ game: { id: string; slug: string; title: string; is_active: boolean } }>(
      `/api/admin/catalog/games/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteAdminGame: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/catalog/games/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getAdminGameRegions: (gameId: string) =>
    request<{ regions: AdminRegionItem[] }>(
      `/api/admin/catalog/games/${encodeURIComponent(gameId)}/regions`
    ),

  createAdminGameRegion: (
    gameId: string,
    payload: {
      regionCode: string;
      regionName: string;
      serverHint?: string | null;
      isActive?: boolean;
    }
  ) =>
    request<{ region: AdminRegionItem }>(
      `/api/admin/catalog/games/${encodeURIComponent(gameId)}/regions`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateAdminGameRegion: (
    gameId: string,
    regionId: string,
    payload: Partial<{
      regionCode: string;
      regionName: string;
      serverHint: string | null;
      isActive: boolean;
    }>
  ) =>
    request<{ region: AdminRegionItem }>(
      `/api/admin/catalog/games/${encodeURIComponent(gameId)}/regions/${encodeURIComponent(regionId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteAdminGameRegion: (gameId: string, regionId: string) =>
    request<{ ok: boolean }>(
      `/api/admin/catalog/games/${encodeURIComponent(gameId)}/regions/${encodeURIComponent(regionId)}`,
      {
        method: 'DELETE',
      }
    ),

  getAdminCurrencies: () =>
    request<{ currencies: AdminCurrencyItem[] }>('/api/admin/catalog/currencies'),

  createAdminCurrency: (payload: {
    code: string;
    name: string;
    symbol: string;
    description?: string;
    imageUrl?: string | null;
    mediaId?: string | null;
    gameId?: string | null;
    isActive?: boolean;
    sortOrder?: number;
  }) =>
    request<{ currency: { id: string; code: string; name: string } }>(
      '/api/admin/catalog/currencies',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateAdminCurrency: (
    id: string,
    payload: Partial<{
      code: string;
      name: string;
      symbol: string;
      description: string;
      imageUrl: string | null;
      mediaId: string | null;
      gameId: string | null;
      isActive: boolean;
      sortOrder: number;
    }>
  ) =>
    request<{ currency: { id: string; code: string; name: string; is_active: boolean } }>(
      `/api/admin/catalog/currencies/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteAdminCurrency: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/catalog/currencies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getAdminPackages: (params?: {
    gameId?: string;
    currencyId?: string;
    status?: string;
    search?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.gameId && params.gameId !== 'all') qs.set('gameId', params.gameId);
    if (params?.currencyId && params.currencyId !== 'all') qs.set('currencyId', params.currencyId);
    if (params?.status && params.status !== 'all') qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ packages: AdminPackageItem[] }>(`/api/admin/catalog/packages${suffix}`);
  },

  createAdminPackage: (payload: {
    gameId: string;
    gameCurrencyId?: string | null;
    sku: string;
    name: string;
    description?: string;
    inGameAmount: number;
    inGameUnit: string;
    priceInr: number;
    originalPriceInr?: number | null;
    discountPercent?: number;
    bonusBadge?: string;
    imageUrl?: string | null;
    mediaId?: string | null;
    deliveryType?: 'manual' | 'automatic' | 'both';
    supplierId?: string | null;
    supplierProductCode?: string;
    supplierCostInr?: number;
    isFeatured?: boolean;
    isActive?: boolean;
    sortOrder?: number;
  }) =>
    request<{ package: { id: string; sku: string; name: string; price_inr: string } }>(
      '/api/admin/catalog/packages',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateAdminPackage: (
    id: string,
    payload: Partial<{
      gameId: string;
      gameCurrencyId: string | null;
      sku: string;
      name: string;
      description: string;
      inGameAmount: number;
      inGameUnit: string;
      priceInr: number;
      originalPriceInr: number | null;
      discountPercent: number;
      bonusBadge: string;
      imageUrl: string | null;
      mediaId: string | null;
      deliveryType: 'manual' | 'automatic' | 'both';
      supplierId: string | null;
      supplierProductCode: string;
      supplierCostInr: number;
      isFeatured: boolean;
      isActive: boolean;
      sortOrder: number;
    }>
  ) =>
    request<{ package: { id: string; name: string; price_inr: string; is_active: boolean } }>(
      `/api/admin/catalog/packages/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  updateAdminPackagePrice: (
    id: string,
    payload: {
      priceInr?: number;
      originalPriceInr?: number | null;
      discountPercent?: number;
      supplierCostInr?: number;
      bonusBadge?: string;
    }
  ) =>
    request<{
      id: string;
      priceInr: number;
      originalPriceInr: number | null;
      discountPercent: number;
      supplierCostInr: number;
      bonusBadge: string;
      netProfitInr: number;
      marginPercent: number;
    }>(`/api/admin/catalog/packages/${encodeURIComponent(id)}/price`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  duplicateAdminPackage: (id: string) =>
    request<{ package: { id: string; sku: string; name: string } }>(
      `/api/admin/catalog/packages/${encodeURIComponent(id)}/duplicate`,
      {
        method: 'POST',
      }
    ),

  deleteAdminPackage: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/catalog/packages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getAdminMedia: (search?: string) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return request<{ media: AdminMediaItem[] }>(`/api/admin/media${qs}`);
  },

  uploadAdminMedia: (payload: {
    fileName: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    dataBase64: string;
    altText?: string;
  }) =>
    request<{ media: AdminMediaItem }>('/api/admin/media/upload', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteAdminMedia: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/media/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getAdminOrders: (params?: { search?: string; gameId?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.gameId && params.gameId !== 'all') qs.set('gameId', params.gameId);
    if (params?.status && params.status !== 'all') qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ orders: AdminOrderItem[] }>(`/api/admin/orders${suffix}`);
  },

  getAdminOrderById: (id: string) =>
    request<{ order: AdminOrderItem }>(`/api/admin/orders/${encodeURIComponent(id)}`),

  updateAdminOrder: (
    id: string,
    payload: {
      status?: string;
      fulfillmentStatus?: string;
      deliveryMethod?: 'manual' | 'automatic' | 'both';
      adminNote?: string;
      deliveryNotes?: string;
      customerDeliveryMessage?: string;
      confirmCompleted?: boolean;
    }
  ) =>
    request<{
      ok: boolean;
      status: string;
      displayOrderStatus: string;
      adminNote: string;
      deliveryNotes: string;
      customerDeliveryMessage: string;
    }>(`/api/admin/orders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getAdminSuppliers: () =>
    request<{ suppliers: AdminSupplierItem[] }>('/api/admin/suppliers'),

  createAdminSupplier: (payload: {
    name: string;
    code: string;
    integrationType?: 'manual' | 'api' | 'webhook';
    mode?: 'mock' | 'live';
    apiBaseUrl?: string | null;
    apiKeyEnvName?: string;
    isActive?: boolean;
    timeoutMs?: number;
    maxRetries?: number;
    supportedGamesNote?: string;
    notes?: string;
  }) =>
    request<{ supplier: { id: string; name: string; code: string } }>('/api/admin/suppliers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAdminSupplier: (
    id: string,
    payload: Partial<{
      name: string;
      code: string;
      integrationType: 'manual' | 'api' | 'webhook';
      mode: 'mock' | 'live';
      apiBaseUrl: string | null;
      apiKeyEnvName: string;
      isActive: boolean;
      timeoutMs: number;
      maxRetries: number;
      supportedGamesNote: string;
      notes: string;
    }>
  ) =>
    request<{ ok: boolean }>(`/api/admin/suppliers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteAdminSupplier: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/suppliers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getAdminSupplierMappings: () =>
    request<{ mappings: SupplierPackageMappingItem[] }>('/api/admin/supplier-mappings'),

  saveAdminSupplierMapping: (payload: {
    supplierId: string;
    packageId: string;
    externalProductCode: string;
    externalProductName?: string;
    supplierCostInr?: number;
    isActive?: boolean;
  }) =>
    request<{ id: string }>('/api/admin/supplier-mappings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteAdminSupplierMapping: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/supplier-mappings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getAdminSupplierOrders: () =>
    request<{ supplierOrders: SupplierOrderItem[] }>('/api/admin/supplier-orders'),

  dispatchOrderToSupplier: (orderId: string, supplierId?: string) =>
    request<{
      supplierOrderId: string;
      isMock: boolean;
      environmentLabel: string;
      status: string;
      error?: string;
    }>(`/api/admin/orders/${encodeURIComponent(orderId)}/dispatch-supplier`, {
      method: 'POST',
      body: JSON.stringify(supplierId ? { supplierId } : {}),
    }),

  checkSupplierOrderStatus: (supplierOrderId: string) =>
    request<{
      ok: boolean;
      isMock: boolean;
      environmentLabel: string;
      status: string;
      notice: string;
    }>(`/api/admin/supplier-orders/${encodeURIComponent(supplierOrderId)}/check-status`, {
      method: 'POST',
    }),

  retrySupplierOrder: (supplierOrderId: string) =>
    request<{
      ok: boolean;
      attemptCount: number;
      status: string;
      isMock: boolean;
      environmentLabel: string;
      error?: string;
    }>(`/api/admin/supplier-orders/${encodeURIComponent(supplierOrderId)}/retry`, {
      method: 'POST',
    }),

  getAdminCustomers: (search?: string) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return request<{ customers: AdminCustomerItem[] }>(`/api/admin/customers${qs}`);
  },

  getAdminWebsiteSettings: () =>
    request<{ settings: StorefrontIdentitySettings }>('/api/admin/website-settings'),

  updateAdminWebsiteSettings: (payload: StorefrontIdentitySettings) =>
    request<{ settings: StorefrontIdentitySettings }>('/api/admin/website-settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getAdminProfile: () => request<AdminProfileResponse>('/api/admin/profile'),

  updateAdminProfile: (payload: { fullName: string; phone?: string | null }) =>
    request<{ ok: boolean; fullName: string; phone: string | null }>('/api/admin/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getAdminSettings: () => request<AdminSettingsResponse>('/api/admin/settings'),

  updateChecklistItem: (payload: { key: string; status: ChecklistStatus; note?: string }) =>
    request<{
      checklist: ChecklistItemState[];
      liveModeEligible: boolean;
      liveModeBlockers: string[];
    }>('/api/admin/settings/checklist', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  updatePaymentMode: (mode: PaymentMode) =>
    request<{ paymentMode: PaymentMode }>('/api/admin/settings/payment-mode', {
      method: 'PATCH',
      body: JSON.stringify({ mode }),
    }),
};
