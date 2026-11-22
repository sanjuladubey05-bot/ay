const ALLOWED_LOCAL_ASSET_PREFIXES = ['/media/', '/src/assets/'];

/**
 * Validates URLs rendered into clickable external anchor tags (<a href="...">).
 * Only permits explicit http:// or https:// URLs. Rejects javascript:, data:, vbscript:, etc.
 */
export function sanitizeExternalHref(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Validates URLs rendered into <img> src attributes (external HTTPS/HTTP or safe local asset routes).
 * Blocks javascript:, data:, protocol-relative //host paths, and path traversal.
 */
export function sanitizeMediaSrc(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//') || trimmed.includes('\\') || trimmed.includes('..')) {
      return null;
    }
    if (ALLOWED_LOCAL_ASSET_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
      return trimmed;
    }
    return null;
  }

  return sanitizeExternalHref(trimmed);
}
