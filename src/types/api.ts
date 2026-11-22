import type {
  AdminRoleCode,
  AuditLogRecord,
  ChecklistItemState,
  ChecklistStatus,
  PaymentMode,
  PaymentStatus,
  PermissionCode,
  PlayerFieldDefinition,
  StoreGameDetail,
  StoreGameSummary,
  StorefrontIdentitySettings,
} from './database';

export interface AuthenticatedUser {
  profileId: string;
  email: string;
  fullName: string;
  isAdmin: boolean;
  isOwner: boolean;
  roleCode: AdminRoleCode | 'customer';
  permissions: PermissionCode[];
  customerId: string | null;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user: AuthenticatedUser | null;
  adminBootstrapRequired: boolean;
  authMode: 'local_postgres' | 'supabase_hybrid';
}

export interface EnvReadinessSummary {
  supabaseUrlConfigured: boolean;
  supabaseAnonKeyConfigured: boolean;
  supabaseServiceRoleConfigured: boolean;
  databaseUrlConfigured: boolean;
  razorpayKeyIdConfigured: boolean;
  razorpayKeySecretConfigured: boolean;
  razorpayWebhookSecretConfigured: boolean;
  razorpayKeyType: 'missing' | 'test' | 'live' | 'invalid';
}

export interface AdminDashboardStats {
  totalGames: number;
  activeGames: number;
  totalPackages: number;
  totalOrders: number;
  pendingOrders: number;
  completedOrders: number;
  totalCustomers: number;
}

export interface AdminRecentOrderSummary {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  gameTitle: string;
  packageName: string;
  totalInr: number;
  status: string;
  displayOrderStatus: string;
  createdAt: string;
}

export interface AdminRecentGameSummary {
  id: string;
  slug: string;
  title: string;
  category: string;
  isActive: boolean;
  isFeatured: boolean;
  coverImageUrl: string | null;
  createdAt: string;
}

export interface SalesPeriodKpi {
  grossRevenueInr: number;
  supplierCostInr: number;
  refundsInr: number;
  netProfitInr: number;
  netMarginPercent: number;
  orderCount: number;
}

export interface SalesChartPoint {
  label: string;
  grossRevenueInr: number;
  supplierCostInr: number;
  refundsInr: number;
  netProfitInr: number;
  netMarginPercent: number;
  orderCount: number;
}

export interface AdminSalesAnalytics {
  periods: {
    day: SalesPeriodKpi;
    week: SalesPeriodKpi;
    month: SalesPeriodKpi;
    all: SalesPeriodKpi;
  };
  series: {
    day: SalesChartPoint[];
    week: SalesChartPoint[];
    month: SalesChartPoint[];
  };
}

export interface AdminOverviewResponse {
  stats: AdminDashboardStats;
  salesAnalytics: AdminSalesAnalytics;
  recentOrders: AdminRecentOrderSummary[];
  recentGames: AdminRecentGameSummary[];
  database: {
    engine: 'postgres' | 'pglite';
    connected: boolean;
    migrationsApplied: string[];
    coreTablesPresent: number;
    coreTablesExpected: number;
    rlsEnabledTables: number;
  };
  paymentGateway: {
    provider: 'razorpay';
    mode: PaymentMode;
    credentialsReady: boolean;
    checklistCompletedCount: number;
    checklistTotalCount: number;
  };
  security: {
    publicAdminRegistrationDisabled: boolean;
    serviceRoleExposedToClient: false;
    rateLimitingActive: boolean;
    failedCheckoutLimitPerMinute: number;
    auditLogCount: number;
  };
  recentAuditLogs: AuditLogRecord[];
}

export interface AdminSettingsResponse {
  paymentMode: PaymentMode;
  envReadiness: EnvReadinessSummary;
  checklist: ChecklistItemState[];
  liveModeEligible: boolean;
  liveModeBlockers: string[];
}

export interface AdminGameItem {
  id: string;
  slug: string;
  title: string;
  publisher: string;
  category: string;
  description: string;
  coverImageUrl: string | null;
  coverMediaId: string | null;
  deliveryMode: 'manual' | 'automatic' | 'hybrid';
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  defaultSupplierId?: string | null;
  defaultSupplierName?: string | null;
  playerFields: PlayerFieldDefinition[];
  packageCount: number;
  orderCount: number;
  createdAt: string;
}

export interface AdminCurrencyItem {
  id: string;
  code: string;
  name: string;
  symbol: string;
  description: string;
  imageUrl: string | null;
  mediaId: string | null;
  gameId: string | null;
  gameTitle: string | null;
  currencyKind: 'settlement' | 'in_game';
  isActive: boolean;
  sortOrder: number;
  packageCount: number;
  createdAt: string;
}

export interface AdminRegionItem {
  id: string;
  gameId: string;
  regionCode: string;
  regionName: string;
  serverHint: string | null;
  isActive: boolean;
}

export interface AdminPackageItem {
  id: string;
  gameId: string;
  gameTitle: string;
  gameCurrencyId: string | null;
  gameCurrencyName: string | null;
  regionId: string | null;
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
  supplierName: string | null;
  supplierProductCode: string;
  supplierCostInr: number;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
  orderCount: number;
  createdAt: string;
}

export interface AdminMediaItem {
  id: string;
  storageBucket: string;
  storagePath: string;
  publicUrl: string;
  mimeType: string;
  byteSize: number;
  altText: string;
  createdAt: string;
  referenceCount: number;
}

export interface SupplierOrderItem {
  id: string;
  orderId: string;
  orderItemId: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  externalReference: string | null;
  costInr: number;
  status: 'pending' | 'submitted' | 'completed' | 'failed' | 'cancelled';
  isMock: boolean;
  environmentLabel: string;
  attemptCount: number;
  maxAttempts: number;
  errorMessage: string;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDeliveryLogItem {
  id: string;
  orderId: string;
  actorLabel: string;
  eventType: string;
  previousStatus: string | null;
  nextStatus: string | null;
  deliveryMethod: string | null;
  isMock: boolean;
  message: string;
  createdAt: string;
}

export interface AdminSupplierItem {
  id: string;
  name: string;
  code: string;
  integrationType: 'manual' | 'api' | 'webhook';
  mode: 'mock' | 'live';
  apiBaseUrl: string | null;
  apiKeyEnvName: string;
  apiKeyConfigured: boolean;
  isActive: boolean;
  timeoutMs: number;
  maxRetries: number;
  balanceInr: number;
  supportedGamesNote: string;
  notes: string;
  mappingCount: number;
  supplierOrderCount: number;
  createdAt: string;
}

export interface SupplierPackageMappingItem {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  supplierMode: 'mock' | 'live';
  packageId: string;
  packageName: string;
  packageSku: string;
  gameId: string;
  gameTitle: string;
  externalProductCode: string;
  externalProductName: string;
  supplierCostInr: number;
  isActive: boolean;
  createdAt: string;
}

export interface AdminOrderItem {
  id: string;
  orderNumber: string;
  orderItemId: string | null;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerCode: string;
  gameId: string | null;
  gameTitle: string;
  packageId: string | null;
  packageName: string;
  inGameAmount: number;
  inGameUnit: string;
  quantity: number;
  totalInr: number;
  supplierCostInr: number;
  netProfitInr: number;
  currencyCode: string;
  status: string;
  displayOrderStatus: string;
  paymentStatus: string;
  displayPaymentStatus: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  supplierTxId: string | null;
  deliveryMethod: 'manual' | 'automatic' | 'both';
  fulfillmentStatus: string;
  displayDeliveryStatus: string;
  regionName: string | null;
  targetPlayerUid: string;
  targetServerId: string | null;
  playerDetails: Record<string, string>;
  customerNote: string | null;
  adminNote: string;
  deliveryNotes: string;
  customerDeliveryMessage: string;
  processedByName: string | null;
  processingStartedAt: string | null;
  completedByName: string | null;
  fulfilledAt: string | null;
  supplierOrders?: SupplierOrderItem[];
  deliveryLogs?: OrderDeliveryLogItem[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminCustomerItem {
  id: string;
  profileId: string;
  customerCode: string;
  fullName: string;
  email: string;
  phone: string | null;
  accountStatus: string;
  riskFlag: string;
  defaultCurrencyCode: string;
  totalOrders: number;
  createdAt: string;
}

export interface AdminProfileResponse {
  profile: {
    profileId: string;
    email: string;
    fullName: string;
    phone: string | null;
    roleCode: string;
    roleName: string;
    isOwner: boolean;
    createdAt: string;
    lastLoginAt: string | null;
  };
  recentActions: AuditLogRecord[];
}

export interface UpdateChecklistRequest {
  key: string;
  status: ChecklistStatus;
  note?: string;
}

export interface UpdatePaymentModeRequest {
  mode: PaymentMode;
}

export interface CreatePaymentOrderRequest {
  packageId: string;
  regionId?: string;
  targetPlayerUid: string;
  targetServerId?: string;
  quantity?: number;
}

export interface PaymentStatusResponse {
  orderId: string;
  orderNumber: string;
  paymentId: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  status: PaymentStatus;
  mode: PaymentMode;
  amountPaise: number;
  amountInr: number;
  signatureVerified: boolean;
  fulfillmentAuthorized: boolean;
}

export interface StoreGamesListResponse {
  games: StoreGameSummary[];
  categories: string[];
}

export interface StoreGameDetailResponse {
  game: StoreGameDetail;
}

export interface PlaceOrderRequest {
  packageId: string;
  regionId?: string;
  quantity?: number;
  playerDetails: Record<string, string>;
  customerNote?: string;
  idempotencyKey?: string;
  preferredDeliveryMethod?: 'manual' | 'automatic';
}

export interface PlaceOrderResponse {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  deliveryMethod: 'manual' | 'automatic' | 'both';
  duplicatePrevented?: boolean;
  totalInr: number;
  currencyCode: string;
  paymentNotice: string;
}

export interface CustomerOrderItemView {
  id: string;
  orderNumber: string;
  gameTitle: string;
  gameSlug: string;
  packageName: string;
  inGameAmount: number;
  inGameUnit: string;
  quantity: number;
  totalInr: number;
  currencyCode: string;
  status: string;
  displayOrderStatus: string;
  paymentStatus: string;
  displayPaymentStatus: string;
  deliveryMethod: 'manual' | 'automatic' | 'both';
  fulfillmentStatus: string;
  displayDeliveryStatus: string;
  customerDeliveryMessage: string;
  regionName: string | null;
  playerDetails: Record<string, string>;
  createdAt: string;
}

export interface CustomerProfileResponse {
  profile: {
    email: string;
    fullName: string;
    phone: string | null;
    accountStatus: string;
    customerCode: string;
    defaultCurrencyCode: string;
    totalOrders: number;
    createdAt: string;
  };
}

export type { StorefrontIdentitySettings };
