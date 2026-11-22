import crypto from 'node:crypto';
import dotenv from 'dotenv';
import type { EnvReadinessSummary } from '../types/api';
import type { PaymentMode } from '../types/database';

dotenv.config();

// Ephemeral fallback only for local session signing when SESSION_SECRET is unset
const EPHEMERAL_SESSION_SECRET = crypto.randomBytes(32).toString('hex');

export interface ServerEnvConfig {
  port: number;
  nodeEnv: string;
  appUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  databaseUrl: string;
  razorpayKeyId: string;
  razorpayKeySecret: string;
  razorpayWebhookSecret: string;
  defaultPaymentMode: PaymentMode;
  ownerAdminEmail: string;
  adminBootstrapPassword: string;
  sessionSecret: string;
}

export function getServerEnv(): ServerEnvConfig {
  const rawMode = (process.env.PAYMENT_MODE || 'test').trim().toLowerCase();
  const defaultPaymentMode: PaymentMode = rawMode === 'live' ? 'live' : 'test';

  return {
    port: Number(process.env.PORT || 3000),
    nodeEnv: process.env.NODE_ENV || 'development',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
    supabaseUrl: (process.env.SUPABASE_URL || '').trim(),
    supabaseAnonKey: (process.env.SUPABASE_ANON_KEY || '').trim(),
    supabaseServiceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    databaseUrl: (process.env.DATABASE_URL || '').trim(),
    razorpayKeyId: (process.env.RAZORPAY_KEY_ID || '').trim(),
    razorpayKeySecret: (process.env.RAZORPAY_KEY_SECRET || '').trim(),
    razorpayWebhookSecret: (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim(),
    defaultPaymentMode,
    ownerAdminEmail: (process.env.OWNER_ADMIN_EMAIL || '').trim().toLowerCase(),
    adminBootstrapPassword: (process.env.ADMIN_BOOTSTRAP_PASSWORD || '').trim(),
    sessionSecret: (process.env.SESSION_SECRET || '').trim() || EPHEMERAL_SESSION_SECRET,
  };
}

export function getEnvReadinessSummary(): EnvReadinessSummary {
  const env = getServerEnv();

  let razorpayKeyType: EnvReadinessSummary['razorpayKeyType'] = 'missing';
  if (env.razorpayKeyId) {
    if (env.razorpayKeyId.startsWith('rzp_test_')) {
      razorpayKeyType = 'test';
    } else if (env.razorpayKeyId.startsWith('rzp_live_')) {
      razorpayKeyType = 'live';
    } else {
      razorpayKeyType = 'invalid';
    }
  }

  return {
    supabaseUrlConfigured: Boolean(env.supabaseUrl),
    supabaseAnonKeyConfigured: Boolean(env.supabaseAnonKey),
    supabaseServiceRoleConfigured: Boolean(env.supabaseServiceRoleKey),
    databaseUrlConfigured: Boolean(env.databaseUrl),
    razorpayKeyIdConfigured: Boolean(env.razorpayKeyId),
    razorpayKeySecretConfigured: Boolean(env.razorpayKeySecret),
    razorpayWebhookSecretConfigured: Boolean(env.razorpayWebhookSecret),
    razorpayKeyType,
  };
}
