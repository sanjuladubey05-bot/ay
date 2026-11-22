export type AccountStatus = 'active' | 'suspended' | 'pending';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export type PaymentMode = 'test' | 'live';

export type OrderStatus =
  | 'pending'
  | 'payment_pending'
  | 'awaiting_payment'
  | 'payment_verified'
  | 'paid'
  | 'processing'
  | 'fulfilling'
  | 'awaiting_delivery'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded';

export type ChecklistStatus =
  | 'not_started'
  | 'pending'
  | 'completed'
  | 'requires_attention';

export type AdminRoleCode = 'owner' | 'manager' | 'support' | 'finance';

export type PermissionCode =
  | '*'
  | 'admin.overview.read'
  | 'admin.settings.read'
  | 'admin.settings.write'
  | 'admin.audit.read'
  | 'payments.refund'
  | 'payments.read'
  | 'orders.read'
  | 'orders.manage';

export const CORE_DATABASE_TABLES = [
  'profiles',
  'admin_users',
  'roles',
  'games',
  'game_regions',
  'currencies',
  'packages',
  'customers',
  'orders',
  'order_items',
  'payments',
  'payment_transactions',
  'refunds',
  'suppliers',
  'supplier_orders',
  'expenses',
  'website_settings',
  'website_layouts',
  'uploaded_media',
  'notifications',
  'audit_logs',
] as const;

export type CoreTableName = (typeof CORE_DATABASE_TABLES)[number];

export interface ProfileRecord {
  id: string;
  supabase_auth_id: string | null;
  email: string;
  full_name: string;
  phone: string | null;
  account_status: AccountStatus;
  is_email_verified: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoleRecord {
  id: string;
  code: AdminRoleCode;
  name: string;
  description: string;
  permissions: PermissionCode[];
  is_system: boolean;
}

export interface AdminUserRecord {
  id: string;
  profile_id: string;
  role_id: string;
  is_owner: boolean;
  is_active: boolean;
  mfa_enabled: boolean;
  assigned_by: string | null;
}

export interface AuditLogRecord {
  id: string;
  actor_profile_id: string | null;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  ip_address: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ChecklistItemState {
  stepNumber: number;
  key: string;
  title: string;
  description: string;
  category: 'merchant_kyc' | 'technical_test' | 'live_cutover';
  status: ChecklistStatus;
  docsUrl: string;
  docsLabel: string;
  requiresExternalPortal: boolean;
  updatedAt: string | null;
  note: string;
}

export interface PlayerFieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'select';
  placeholder?: string;
  hint?: string;
  required: boolean;
  options?: string[];
  validationRegex?: string;
  validationMessage?: string;
}

export interface StoreGameSummary {
  id: string;
  slug: string;
  title: string;
  publisher: string;
  category: string;
  description: string;
  coverImageUrl: string | null;
  deliveryMode: 'manual' | 'automatic' | 'hybrid';
  isFeatured: boolean;
  packageCount: number;
  startingPriceInr: number | null;
}

export interface StoreRegionItem {
  id: string;
  regionCode: string;
  regionName: string;
  serverHint: string | null;
}

export interface StoreGameCurrencyItem {
  id: string;
  code: string;
  name: string;
  description: string;
  imageUrl: string | null;
}

export interface StorePackageItem {
  id: string;
  sku: string;
  name: string;
  inGameAmount: number;
  inGameUnit: string;
  priceInr: number;
  originalPriceInr: number | null;
  discountPercent: number;
  bonusBadge: string;
  description: string;
  isFeatured: boolean;
  currencyCode: string;
  currencySymbol: string;
  gameCurrencyId: string | null;
  gameCurrencyName: string | null;
  gameCurrencyImageUrl: string | null;
  regionId: string | null;
  imageUrl: string | null;
  deliveryType: 'manual' | 'automatic' | 'both';
}

export interface StoreGameDetail {
  id: string;
  slug: string;
  title: string;
  publisher: string;
  category: string;
  description: string;
  coverImageUrl: string | null;
  deliveryMode: 'manual' | 'automatic' | 'hybrid';
  playerFields: PlayerFieldDefinition[];
  regions: StoreRegionItem[];
  gameCurrencies: StoreGameCurrencyItem[];
  packages: StorePackageItem[];
  currencies: {
    code: string;
    name: string;
    symbol: string;
  }[];
}

export interface StorefrontIdentitySettings {
  storeName: string;
  storeLogoUrl: string | null;
  heroHeading: string;
  heroSubtitle: string;
  supportEmail: string;
  whatsappContact: string;
  footerDescription: string;
  supportHours: string;
  supportNote: string;
  announcementEnabled: boolean;
  announcementText: string;
  socialLinks: {
    discord: string;
    instagram: string;
    youtube: string;
    x: string;
  };
}
