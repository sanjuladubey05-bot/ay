import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getServerEnv } from '../configuration/env';

/**
 * Server-only Supabase client factories.
 * NEVER import this module from frontend React components.
 */
export function getSupabaseAnonClient(): SupabaseClient | null {
  const env = getServerEnv();
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return null;
  }
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function getSupabaseServiceClient(): SupabaseClient | null {
  const env = getServerEnv();
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return null;
  }
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
