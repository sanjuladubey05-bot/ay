import dns from 'node:dns/promises';
import net from 'node:net';

export { sanitizeExternalHref, sanitizeMediaSrc } from './displayUrl';

/**
 * Returns true if an IPv4/IPv6 literal points to loopback, private, link-local, metadata, or unspecified space.
 */
export function isPrivateOrRestrictedIp(ipInput: string): boolean {
  const cleaned = ipInput.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!cleaned) return true;

  // Handle IPv4-mapped IPv6 like ::ffff:127.0.0.1 or ::ffff:169.254.169.254
  if (cleaned.startsWith('::ffff:')) {
    const v4Part = cleaned.slice('::ffff:'.length);
    if (net.isIPv4(v4Part)) {
      return isPrivateOrRestrictedIp(v4Part);
    }
  }

  const version = net.isIP(cleaned);
  if (version === 4) {
    const octets = cleaned.split('.').map((n) => Number(n));
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = octets;
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 192 && b === 0 && (octets[2] === 0 || octets[2] === 2)) return true; // IETF / TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }

  if (version === 6) {
    const normalized = cleaned.split('%')[0];
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true; // Link-local & unique local addresses
    }
    if (normalized.startsWith('ff')) return true; // Multicast
    return false;
  }

  return true;
}

/**
 * Validates supplier API base URLs against scheme and private/internal network targets.
 */
export function validateSupplierApiBaseUrl(rawUrl: string): {
  valid: boolean;
  normalized?: string;
  error?: string;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: true, normalized: '' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Supplier API Base URL must be a valid URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: 'Supplier API Base URL must use HTTPS.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'Embedded credentials inside Supplier API URL are not permitted.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    return {
      valid: false,
      error: 'Supplier API URL cannot target local or internal hostnames.',
    };
  }

  if (net.isIP(host.replace(/^\[|\]$/g, '')) !== 0 && isPrivateOrRestrictedIp(host)) {
    return {
      valid: false,
      error: 'Supplier API URL cannot target private, loopback, or link-local IP addresses.',
    };
  }

  return { valid: true, normalized: parsed.toString().replace(/\/+$/, '') };
}

/**
 * Resolves DNS right before an outbound supplier fetch and blocks any hostname resolving
 * to private, loopback, or metadata IP addresses.
 */
export async function assertPublicSupplierEndpoint(
  rawUrl: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const checked = validateSupplierApiBaseUrl(rawUrl);
  if (!checked.valid || !checked.normalized) {
    return { ok: false, error: checked.error || 'Invalid supplier API URL.' };
  }

  const parsed = new URL(checked.normalized);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrRestrictedIp(hostname)) {
      return { ok: false, error: 'Supplier endpoint resolves to a restricted IP address.' };
    }
    return { ok: true, url: checked.normalized };
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length || records.some((r) => isPrivateOrRestrictedIp(r.address))) {
      return { ok: false, error: 'Supplier host resolves to a restricted network address.' };
    }
    return { ok: true, url: checked.normalized };
  } catch {
    return { ok: false, error: 'Unable to resolve supplier API hostname.' };
  }
}
